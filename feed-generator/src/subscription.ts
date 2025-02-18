import {
  OutputSchema as RepoEvent,
  isCommit,
} from './lexicon/types/com/atproto/sync/subscribeRepos'
import { FirehoseSubscriptionBase, getOpsByType } from './util/subscription'
import { DatabaseSchema } from './db/schema'
import { Kysely } from 'kysely'

const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite-preview-02-05"})


interface CompletionResponse {
  content: string;
}

const MLB_KEYWORDS = [
    'shohei',
    'shouhei',
    '大谷',
    'ohtani',
    'Ohtani',
    'Otani',
    'otani',
    '翔平',
//    'love',
  ].map(keyword => keyword.toLowerCase());

  const MLB_KEYWORDS2 = [
    '大谷翔平',
    '大谷 翔平',
    'shohei ohtani',
    'shohei otani',
    'shouhei otani',
    'shouhei ohtani',
  ].map(keyword => keyword.toLowerCase());


const WATCHED_ACCOUNTS = [
//  'olmlb.bsky.social',
//  'aimbotkris.bsky.social',
//  'dustintanner.bsky.social',
//  'parkermolloy.com',
//  'fantasymlbnews.bsky.social',
//  'mlbtraderumors.bsky.social',
  'webbigdata.bsky.social'
];

async function analyzeText(author: string, text: string): Promise<string | null> {
    const systemPrompt = `You are a helpful assistant that can understand both English and Japanese text. For the given text, respond with 'YES' if it contains ANY reference or connection to Shohei Ohtani (大谷翔平), a Japanese baseball player who plays as a pitcher and fielder in the American Major League Baseball(MLB, メジャーリーグ), DODGERS(ドジャーズ). This includes:
- His name in any form (Ohtani, 大谷, 翔平, shohei, etc.)
- His wife Mamiko (真美子さん)
- His dog Deko or Dekopin (デコピン)
- Any other content that mentions or relates to him, even briefly Even if the connection is minor or indirect.
    
Exceptions: Answer 'NO' in the following cases:
- Otani is mentioned in a political context or in hate speech or Bad comments.
- A person named Ohtani who is not a baseball player. (professional wrestling player, Biker, etc)
- 大谷 ミリシタ (Ordinary person)
- #shotaniphone (shot an iphone)
- OTANI from Sunami 
    `;
    
    try {
        console.log('\nProcessing text:', text);
        const result = await model.generateContent([systemPrompt, author + "\n" + text]);
        return result.response.text().trim();
    } catch (error) {
        console.error('gemini error:', error);
        return null;
    }
}

interface Post {
        uri: string;
        cid: string;
        indexedAt: string;
        author: string;
        text: string;
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
                    })
                } catch (error) {
                    console.warn('Warning: Error deleting posts:', error)
                }
            }
      
            // 新規投稿の処理
            const postsToCreate: Post[] = [];
            for (const create of ops.posts.creates) {
                const author = create.author;
                const text = create.record.text;

		// 全部のログチェック
		// console.log('\nProcessing text:', text);
      
                // 条件1: WATCHED_ACCOUNTS に含まれるアカウントの投稿であるか確認
                if (WATCHED_ACCOUNTS.includes(author)) {
                    postsToCreate.push({
                    uri: create.uri,
                    cid: create.cid,
                    indexedAt: new Date().toISOString(),
                    author: author,
                    text: text,
                    });
                    continue;
                }
      
                // 条件2: MLB_KEYWORDS2（フルネーム）のチェック
                const lowerCaseText = text.toLowerCase();
                const hasFullNameKeyword = MLB_KEYWORDS2.some(keyword => lowerCaseText.includes(keyword));
              
                if (hasFullNameKeyword) {
                    postsToCreate.push({
                    uri: create.uri,
                    cid: create.cid,
                    indexedAt: new Date().toISOString(),
                    author: author,
                    text: text,
                });
                continue;
        }
      
        // 条件3: MLB_KEYWORDS を含み、かつ、analyzeText 関数の戻り値が 'YES' であるか確認
        const hasKeyword = MLB_KEYWORDS.some(keyword => lowerCaseText.includes(keyword));
      
        if (hasKeyword) {
            const analyzeResult = await analyzeText(author, text);
            console.log('analyzeResult:', analyzeResult);
            if (analyzeResult === 'YES') {
                postsToCreate.push({
                uri: create.uri,
                cid: create.cid,
                indexedAt: new Date().toISOString(),
                author: author,
                text: text,
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
