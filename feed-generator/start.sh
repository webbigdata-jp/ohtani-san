#!/bin/bash

# 設定
PID_FILE="/home/gharada2013/install/ohtani-san/feed-generator/server.pid"
ENV_FILE="/home/gharada2013/install/ohtani-san/feed-generator/.env.gemini"
LOG_FILE="/home/gharada2013/install/ohtani-san/feed-generator/server.log"

# 環境変数ファイルの読み込み
if [ -f "$ENV_FILE" ]; then
    export $(cat "$ENV_FILE" | grep -v '#' | xargs)
else
    echo "警告: $ENV_FILE が見つかりません"
    exit 1
fi

# API_KEYが設定されているか確認
#if [ -z "$GEMINI_API_KEY" ]; then
#    echo "エラー: GEMINI_API_KEY が設定されていません"
#    exit 1
#fi

# サーバーの状態を確認する関数
check_status() {
    if [ -f "$PID_FILE" ]; then
        pid=$(cat "$PID_FILE")
        if ps -p "$pid" > /dev/null; then
            # プロセスツリーを確認して実際のnode/yarnプロセスを特定
            child_pid=$(pgrep -P "$pid" -f "node\|yarn")
            if [ -n "$child_pid" ]; then
                echo "サーバー稼働中 (PID: $child_pid)"
                echo "実行時間: $(ps -o etime= -p $child_pid)"
                echo "メモリ使用量: $(ps -o %mem= -p $child_pid)%"
                echo "CPU使用率: $(ps -o %cpu= -p $child_pid)%"
                return 0
            fi
        fi
        echo "警告: PIDファイルは存在しますが、有効なプロセスが見つかりません"
        rm "$PID_FILE"
        return 1
    else
        echo "サーバーは停止しています"
        return 3
    fi
}

# プロセスを安全に終了する関数
safe_kill() {
    local pid=$1
    local max_attempts=5
    local attempt=1
    
    # まずSIGTERMで終了を試みる
    kill -TERM "$pid" 2>/dev/null
    
    # プロセスの終了を待つ
    while ps -p "$pid" > /dev/null && [ $attempt -le $max_attempts ]; do
        echo "プロセス終了待機中... 試行 $attempt/$max_attempts"
        sleep 2
        attempt=$((attempt + 1))
    done
    
    # まだ生きていれば、SIGKILLを送る
    if ps -p "$pid" > /dev/null; then
        echo "強制終了を実行します..."
        kill -9 "$pid" 2>/dev/null
        sleep 1
    fi
    
    # プロセスが本当に終了したか確認
    if ! ps -p "$pid" > /dev/null; then
        return 0
    else
        return 1
    fi
}

# サーバーを停止する関数
stop_server() {
    if [ -f "$PID_FILE" ]; then
        pid=$(cat "$PID_FILE")
        child_pid=$(pgrep -P "$pid" -f "node\|yarn")
        
        if [ -n "$child_pid" ]; then
            echo "子プロセスを停止します (PID: $child_pid)"
            if safe_kill "$child_pid"; then
                echo "子プロセスの停止に成功しました"
            else
                echo "警告: 子プロセスの停止に失敗しました"
            fi
        fi
        
        if ps -p "$pid" > /dev/null; then
            echo "親プロセスを停止します (PID: $pid)"
            if safe_kill "$pid"; then
                echo "親プロセスの停止に成功しました"
            else
                echo "警告: 親プロセスの停止に失敗しました"
            fi
        fi
        
        rm -f "$PID_FILE"
    else
        echo "PIDファイルが見つかりません"
    fi
}

# サーバーを起動する関数
start_server() {
    if [ -f "$PID_FILE" ]; then
        echo "警告: サーバーは既に起動している可能性があります"
        check_status
        return 1
    fi
    
    echo "サーバーを起動します"
    # nohupを使用せず、バックグラウンドで直接実行
    yarn start > "$LOG_FILE" 2>&1 & 
    echo $! > "$PID_FILE"
    sleep 2  # プロセスの起動を待つ
    
    if check_status; then
        echo "サーバーの起動に成功しました"
    else
        echo "警告: サーバーの起動に問題が発生した可能性があります"
        echo "ログファイル($LOG_FILE)を確認してください"
    fi
}

# サーバーを再起動する関数
restart_server() {
    stop_server
    sleep 2  # プロセスが完全に終了するのを待つ
    start_server
}

# コマンドライン引数による制御
case "$1" in
    start)
        start_server
        ;;
    stop)
        stop_server
        ;;
    restart)
        restart_server
        ;;
    status)
        check_status
        ;;
    *)
        echo "使用方法: $0 {start|stop|restart|status}"
        exit 1
        ;;
esac

exit 0
