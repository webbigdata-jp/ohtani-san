# ohtani-san

smart feed generator

## Install

update yarn
```
curl -o- -L https://yarnpkg.com/install.sh | bash
yarn install
```

setup llama.cpp

## Setup

- cp .env.example .env
- FEEDGEN_HOSTNAME="yourdomain.com" (eg:bsky.webbigdata.jp)
- FEEDGEN_PUBLISHER_DID="did:plc:<your_did_info>"
- FEEDGEN_SQLITE_LOCATION="db.sqlite"

## domain setup

- setup your domain.com
- setup your https 
- run nginx as reverse proxy (eg: sudo /opt/bitnami/ctlscript.sh stop nginx)

## How to run

```
./start_1.5b.sh
yarn start
yarn publishFeed
```

example output
```
yarn run v1.22.22
$ ts-node scripts/publishFeedGen.ts
? Enter your Bluesky handle: XXXXX.bsky.social
? Enter your Bluesky password (preferably an App Password):
? Optionally, enter a custom PDS service to sign in with: https://bsky.social
? Enter a short name or the record. This will be shown in the feed's URL: ohtani-san
? Enter a display name for your feed: Ohtanisa-n
? Optionally, enter a brief description of your feed:
? Optionally, enter a local path to an avatar that will be used for the feed:
Done in 173.29s.
```

### sample feed
feed is there.  
https://bsky.app/profile/dahara1.bsky.social/feed/ohtani-san

## reference information

- https://github.com/bluesky-social/feed-generator
- https://docs.bsky.app/docs/starter-templates/custom-feeds
- https://atproto.com/ja


