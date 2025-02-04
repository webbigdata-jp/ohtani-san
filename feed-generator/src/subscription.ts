import {
  OutputSchema as RepoEvent,
  isCommit,
} from './lexicon/types/com/atproto/sync/subscribeRepos'
import { FirehoseSubscriptionBase, getOpsByType } from './util/subscription'
import { DatabaseSchema } from './db/schema'
import { Kysely } from 'kysely'

// LLM関連のアカウントリスト
const LLM_ACCOUNTS = [
  'burnytech.bsky.social',
  'openrouter.bsky.social',
  'sungkim.bsky.social',
  'mechanicaldirk.bsky.social',
  'sakanaai.bsky.social',
  'reachsumit.bsky.social',
  'hamel.bsky.social',
  'rosiecampbell.xyz',
  'hardmaru.bsky.social',
  'nsaphra.bsky.social',
  'tedunderwood.me',
  'eliotkjones.bsky.social',
  'catherinearnett.bsky.social',
  'msharmas.bsky.social',
  'joerocca.bsky.social',
  'aarontay.bsky.social',
  'swyx.io',
  'aurelium.me',
  'pinkddle.bsky.social',
  'tokenbender.bsky.social',
  'geronimo-ai.bsky.social',
  'main-horse.bsky.social',
  'adverb.bsky.social',
  'cloneofsimo.bsky.social',
  'wordgrammer.bsky.social',
  'lhl.bsky.social',
  'quanquangu.bsky.social',
  'nopainkiller.bsky.social',
  'vgel.me',
  'cpaxton.bsky.social',
  'unixpickle.bsky.social',
  'alpindale.bsky.social',
  'repligate.bsky.social',
  'stochasticchasm.bsky.social',
  'kalomaze.bsky.social',
  'xenova.bsky.social',
  'paper.bsky.social',
  'davidberenstein.hf.co',
  'osanseviero.bsky.social',
  'latentspacepod.bsky.social',
  'zacharylipton.bsky.social',
  'xeophon.bsky.social',
  'lauraruis.bsky.social',
  'fofr.ai',
  'pcarter.bsky.social',
  'jeremy.lewi.us',
  'chrisalbon.com',
  'vikhyat.net',
  'minimaxir.bsky.social',
  'eugeneyan.com'
].map(account => account.toLowerCase());

async function analyzeText_lhl(text: string): Promise<boolean> {
  try {
    // ダミーの実装 - 実際の実装では適切なLLMエンドポイントに接続
    return Math.random() > 0.5;
  } catch (error) {
    console.warn('Warning: Error in LLM analysis:', error);
    return false;
  }
}


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
  'Otani',
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
- His dog Dekopin (デコピン)
- His social media accounts
- News articles about him
- Any other content that mentions or relates to him, even briefly
Even if the connection is minor or indirect, respond with 'YES' if there is ANY relation to Ohtani. Only respond with 'NO' if there is absolutely no connection to him or his immediate circle.`;


  const formattedPrompt = `<|im_start|>system
${systemPrompt}<|im_end|>
<|im_start|>user
### target text:
${text}<|im_end|>
<|im_start|>assistant
`;

  try {
    console.log('\nProcessing text:', text);
    console.log('Sending request...');

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
}


export class FirehoseSubscription extends FirehoseSubscriptionBase {
  async handleEvent(evt: RepoEvent) {
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
              
              await trx
                .deleteFrom('lhl_list')
                .where('uri', 'in', postsToDelete)
                .execute()
            })
        } catch (error) {
          console.warn('Warning: Error deleting posts:', error)
        }
      }

      // 新規投稿の処理
      const postsToCreate = ops.posts.creates.map((create) => ({
        uri: create.uri,
        cid: create.cid,
        indexedAt: new Date().toISOString()
      }))

      // LLMアカウントの投稿を処理
      const lhlPostsToCreate = await Promise.all(
        ops.posts.creates
          .filter(create => 
            LLM_ACCOUNTS.some(account => 
              create.author.toLowerCase().includes(account)
            )
          )
          .map(async (create) => {
            const isRelevant = await analyzeText_lhl(create.record.text);
            return {
              uri: create.uri,
              cid: create.cid,
              indexedAt: new Date().toISOString(),
              isRelevant
            };
          })
      )

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

            if (lhlPostsToCreate.length > 0) {
              await trx
                .insertInto('lhl_list')
                .values(lhlPostsToCreate)
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



