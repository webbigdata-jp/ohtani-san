import {
  OutputSchema as RepoEvent,
  isCommit,
} from './lexicon/types/com/atproto/sync/subscribeRepos'
import { FirehoseSubscriptionBase, getOpsByType } from './util/subscription'
import { DatabaseSchema } from './db/schema'
import { Kysely } from 'kysely'


interface CompletionResponse {
  content: string;
}

const MLB_KEYWORDS = [
//  'メジャーリーグ',
//  'mlb',
//  'dodgers',
//  'ドジャース',
  'shohei',
  'shouhei',
  '大谷',
  'ohtani',
  'Ohtani',
  'Otani',
  'otani',
  '翔平',
//  'Major League',
//  'プロ野球',
//  '大リーグ'
].map(keyword => keyword.toLowerCase());


const WATCHED_ACCOUNTS = [
  'olmlb.bsky.social',
  'aimbotkris.bsky.social',
  'dustintanner.bsky.social',
  'parkermolloy.com',
  'fantasymlbnews.bsky.social',
  'mlbtraderumors.bsky.social',
  'webbigdata.bsky.social'
];

async function analyzeText(text: string): Promise<string | null> {
  const systemPrompt = `You are a helpful assistant that can understand both English and Japanese text. For the given text, respond with 'YES' if it contains ANY reference or connection to Shohei Ohtani (大谷翔平), a Japanese baseball player who plays as a pitcher and fielder in the American MLB(Major League Baseball:メジャーリーグ), DODGERS(ドジャーズ). This includes:
- His name in any form (Ohtani, 大谷, 翔平, shohei, etc.)
- His wife Mamiko (真美子さん)
- His dog Deko or Dekopin (デコピン)
- His social media accounts
- News articles about him - Any other content that mentions or relates to him, even briefly
Even if the connection is minor or indirect, respond with 'YES' if there is ANY relation to Ohtani. Only respond with 'NO' if there is absolutely no connection to him or his immediate circle or A person named Ohtani who is not a baseball player.`;


  const formattedPrompt = `<|im_start|>system
${systemPrompt}<|im_end|>
<|im_start|>user
### target text:
${text}<|im_end|>
<|im_start|>assistant
`;

  try {
    console.log('\nProcessing text:', text);
    //console.log('Sending request...');

    const response = await fetch('http://localhost:8080/completion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt: formattedPrompt,
        n_predict: 256,
        temperature: 0.1,
        stop: ["<|im_end|>"]
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json() as CompletionResponse;
    return result.content.trim();

  } catch (error) {
    console.error('Error:', error);
    return null;
  }
}

interface Post {
  uri: string;
  cid: string;
  indexedAt: string;
  author: string; // 追加
  text: string; // 追加
}

export class FirehoseSubscription extends FirehoseSubscriptionBase {

  async handleEvent(evt: RepoEvent) {
//    console.log("FirehoseSubscription")
    try {
      if (!isCommit(evt)) return

      const ops = await getOpsByType(evt)

      // 削除処理
      const postsToDelete = ops.posts.deletes.map((del) => del.uri)
      if (postsToDelete.length > 0) {
        try {
          await (this.db as unknown as Kysely<DatabaseSchema>)
            .transaction().execute(async (trx) => {
              await trx
                .deleteFrom('post')
                .where('uri', 'in', postsToDelete)
                .execute()

            })
        } catch (error) {
          console.warn('Warning: Error deleting posts:', error)
        }
      }

      // 新規投稿の処理
      /*
      const postsToCreate = ops.posts.creates.map((create) => ({
        uri: create.uri,
        cid: create.cid,
        indexedAt: new Date().toISOString()
      }))
      */
      // 新規投稿の処理
      const postsToCreate: Post[] = [];
      for (const create of ops.posts.creates) {
        const author = create.author; // ハンドルネームを取得
        const text = create.record.text; // 投稿内容を取得

        // 条件1: WATCHED_ACCOUNTS に含まれるアカウントの投稿であるか確認
        if (WATCHED_ACCOUNTS.includes(author)) {

          postsToCreate.push({
            uri: create.uri,
            cid: create.cid,
            indexedAt: new Date().toISOString(),
            author: author, // 追加
            text: text,     // 追加
          });
          continue; // この投稿は条件を満たしているので、次の投稿へ
        }

        // 条件2: MLB_KEYWORDS を含み、かつ、analyzeText 関数の戻り値が 'YES' であるか確認
        const lowerCaseText = text.toLowerCase();
        const hasKeyword = MLB_KEYWORDS.some(keyword => lowerCaseText.includes(keyword));

        if (hasKeyword) {
          const analyzeResult = await analyzeText(text);
          console.log('analyzeResult:', analyzeResult);
          if (analyzeResult === 'YES') {
            postsToCreate.push({
              uri: create.uri,
              cid: create.cid,
              indexedAt: new Date().toISOString(),
              author: author, // 追加
              text: text,     // 追加
            });
          }
        }
      }


      // データベースに保存
      try {
        await (this.db as unknown as Kysely<DatabaseSchema>)
          .transaction().execute(async (trx) => {
            if (postsToCreate.length > 0) {
              await trx
                .insertInto('post')
                .values(postsToCreate)
                .execute()
            }

          })
      } catch (error) {
        console.warn('Warning: Error inserting posts:', error)
      }

    } catch (error) {
      console.warn('Warning: Error in handleEvent:', error)
    }
  }
}

