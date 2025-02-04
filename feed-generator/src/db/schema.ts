export type DatabaseSchema = {
  post: Post
  sub_state: SubState,
  lhl_list: LhlPost 
}

export type Post = {
  uri: string
  cid: string
  indexedAt: string
}

export type SubState = {
  service: string
  cursor: number
}

// 新しく追加するテーブルの型定義
export type LhlPost = {
  uri: string
  cid: string
  indexedAt: string
  isRelevant: boolean
}

