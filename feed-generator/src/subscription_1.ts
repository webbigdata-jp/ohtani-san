import {
  OutputSchema as RepoEvent,
  isCommit,
} from './lexicon/types/com/atproto/sync/subscribeRepos'
import { FirehoseSubscriptionBase, getOpsByType } from './util/subscription'

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
    if (!isCommit(evt)) return

    const ops = await getOpsByType(evt)

    const postsToDelete = ops.posts.deletes.map((del) => del.uri)

    const postsToCreate = await Promise.all(
      ops.posts.creates
        .map(async (create) => {  // 型アノテーションを削除
          const text = create.record.text.toLowerCase();
          const authorDid = create.author;  // DIDを取得
          const isWatchedAccount = WATCHED_ACCOUNTS.some(account =>
            authorDid.toLowerCase().includes(account.toLowerCase())
          );
          const hasKeyword = MLB_KEYWORDS.some(keyword => text.includes(keyword));

          if (isWatchedAccount || hasKeyword) {
            console.log(`Author DID: ${authorDid}`);
            console.log(`Content: ${create.record.text}`);
            console.log(`Source: ${isWatchedAccount ? 'Watched Account' : 'Keyword Match'}`);

            const result = await analyzeText(create.record.text);

            if (result?.toUpperCase() === 'YES') {
              console.log("-----------------YES----------------");
              return {
                uri: create.uri,
                cid: create.cid,
                indexedAt: new Date().toISOString(),
              } as Post;
            }
            console.log("==================NO==============");
          }
          return null;
        })
    ).then(results => results.filter((post): post is Post => post !== null));

    // Handle deletions
    if (postsToDelete.length > 0) {
      await this.db
        .deleteFrom('post')
        .where('uri', 'in', postsToDelete)
        .execute()
    }

    // Handle creations
    if (postsToCreate.length > 0) {
      await this.db
        .insertInto('post')
        .values(postsToCreate)
        .onConflict((oc) => oc.doNothing())
        .execute()
    }
  }
}
