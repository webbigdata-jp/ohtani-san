import {
    OutputSchema as RepoEvent,
    isCommit,
} from './lexicon/types/com/atproto/sync/subscribeRepos'
import { FirehoseSubscriptionBase, getOpsByType } from './util/subscription'
import { DatabaseSchema } from './db/schema'
import { Kysely } from 'kysely'

import dotenv from 'dotenv';
// .env.geminiファイルを明示的に指定
dotenv.config({ path: '.env.gemini' });

const { GoogleGenerativeAI } = require("@google/generative-ai");
import https from 'https';
import { EventEmitter } from 'events';
// ディフォルトは10
EventEmitter.defaultMaxListeners = 25;

const blueSkyAgent = new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 3000,
    maxSockets: 100,
    maxFreeSockets: 10,
});

const geminiAgent = new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 3000,
    maxSockets: 6,
    maxFreeSockets: 3,
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY, {
    transport: {
        fetchFunction: (url: string, init?: RequestInit) => {
            return fetch(url, {
                ...init,
                // @ts-ignore
                agent: geminiAgent, 
            });
        },
    },
});
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite-preview-02-05" })

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

async function withRetry<T>(
    operation: () => Promise<T>,
    retries = MAX_RETRIES
): Promise<T> {
    try {
        return await operation();
    } catch (error) {
        if (retries > 0 && error instanceof Error) {
            if (error.message.includes('ECONNRESET') ||
                error.message.includes('fetch failed')) {
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
                return withRetry(operation, retries - 1);
            }
        }
        throw error;
    }
}

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
].map(keyword => keyword.toLowerCase());

const MLB_NG_KEYWORDS = [
    '大谷秀',
    '大谷雄',
    'botan',
    'ミリシタ',
    'Sunami',
    'shotaniphone',
    'Joji Otani',
    'minnesotaNice',
    'otanidiot',
    '大谷日出夫',
    'HO-HO',
    'cheatingfraudgers',
    'CHEATERS',
    'トランプ',
    'イーロン',
    ' DOGE ',
    '政治',
    '首相',
    '大統領',
    'did:plc:bfc6cf4i5sqbblrzmsabefl2',
    ' trump',
    ' elon',
    'republican',
    'Democrat',
    '民主',
    '共和',
    '自民',
    '立憲',
    'minister',
    'oTanik',
    'notAnI', //#NotAnImmigrant
    'ゲーマー',
    '殺人',
    '政府',
    '与党',
    '死者',
    '有罪',
    'ZIP!',
    'ゴゴスマ',
    'ゲーマー',
    '大谷育江',
    '浦川翔平',
    'Deutungshoheit',
    '出勤予定',
    '大谷吉雄',
    '大谷地',
    '下野新聞',
    '財務省',
    '神楽亜貴'
].map(keyword => keyword.toLowerCase());

const MLB_KEYWORDS2 = [
    '大谷翔平',
    '大谷 翔平',
    'shohei ohtani',
    'shohei otani',
    'shouhei otani',
    'shouhei ohtani',
].map(keyword => keyword.toLowerCase());

const MLB_KEYWORDS3 = [
    ' soto',
    ' ippei',
    'dodgers',
    ' MLB',
    'Baseball',
    '一平',
    '野茂',
    '野球',
    'イチロー',
    'Trout',
    'Yankees'
].map(keyword => keyword.toLowerCase());

const WATCHED_ACCOUNTS = [
    //  'olmlb.bsky.social',
    //  'aimbotkris.bsky.social',
    //  'dustintanner.bsky.social',
    //  'parkermolloy.com',
    //  'fantasymlbnews.bsky.social',
    //  'mlbtraderumors.bsky.social',
    'agent-ohtani.bsky.social',
    //'webbigdata.bsky.social'
];

const systemPrompt = `You are a helpful assistant that can understand both English and Japanese text. For the given text, respond with 'YES' if it contains ANY reference or connection to Shohei Ohtani (大谷翔平), a Japanese baseball player who plays as a pitcher and fielder in the American Major League Baseball(MLB, メジャーリーグ), DODGERS(ドジャーズ). This includes:
- His name in any form (Ohtani, 大谷, 翔平, shohei, etc.)
- His wife Mamiko (真美子さん)
- His dog Deko or Dekopin (デコピン)
- Any other content that mentions or relates to him, even briefly Even if the connection is minor or indirect.
    
Exceptions: Answer 'NO' in the following cases:
- Otani is mentioned in a political context or in hate speech or Bad comments.
- A person named Ohtani who is not a baseball player. (professional wrestling player, Biker, etc)
- Text with little information, such as everyday conversation (greetings and replies)
- Text that contains negative emotions that might make Otani fans feel bad (too much news about Otani, not interested in Otani, mentioning Otani in a political context, etc.)
`;

async function analyzeText(author: string, text: string): Promise<string | null> {
    return withRetry(async () => {
        console.log('\nProcessing author + text:', author + "\n" + text);
        const result = await model.generateContent([systemPrompt, author + "\n" + text]);
        return result.response.text().trim();
    });
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

                // collectionのチェックは既にgetOpsByTypeで行われているので、
                // ここではRecordとreplyの存在チェックのみ行う
                const record = create.record;
                if (!record || record.reply) {
                    continue; // 返信の場合はスキップ
                }

                const author = create.author;
                const text = create.record.text;
                const lowerCaseText = text.toLowerCase();
                const lowerCaseAuthor = author.toLowerCase();

                // 条件1: WATCHED_ACCOUNTS に含まれるアカウントの投稿は無条件で採用
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

                // Step 1: MLB_KEYWORDSのチェック
                const hasKeyword = MLB_KEYWORDS.some(keyword => lowerCaseText.includes(keyword));
                if (!hasKeyword) {
                    continue; // キーワードが含まれていなければ次の投稿へ
                }

                // Step 2: MLB_NG_KEYWORDSのチェック
                const hasNgKeyword = MLB_NG_KEYWORDS.some(keyword =>
                    lowerCaseText.includes(keyword) || lowerCaseAuthor.includes(keyword)
                );
                if (hasNgKeyword) {
                    continue; // NGワードが含まれていれば次の投稿へ
                }

                // Step 3: MLB_KEYWORDS2（フルネーム）とMLB_KEYWORDS3の組み合わせチェック
                const hasFullNameKeyword = MLB_KEYWORDS2.some(keyword => lowerCaseText.includes(keyword));
                const hasKeyword3 = MLB_KEYWORDS3.some(keyword => lowerCaseText.includes(keyword));

                if (hasFullNameKeyword || hasKeyword3) {
                    postsToCreate.push({
                        uri: create.uri,
                        cid: create.cid,
                        indexedAt: new Date().toISOString(),
                        author: author,
                        text: text,
                    });
                    continue;
                }

                // Step 4: 上記の条件に該当しない場合のみanalyzeTextを実行
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
