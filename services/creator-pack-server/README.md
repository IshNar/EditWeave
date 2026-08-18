# Creator Pack Server

서명된 `editweave-creator-catalog-v1`과 카탈로그에 고정된 Creator Pack artifact만 제공하는 정적 배포 서버다. 개인 키는 서버에 두지 않는다.

## 배포 준비

1. 앱에서 내보낸 Pack을 제작자의 오프라인 Ed25519 키로 서명한다. 개인 키는 서버나 저장소에 복사하지 않는다.

```powershell
node release/sign-creator-pack.mjs .\My-Pack.editweave-pack.json X:\secure\publisher-private.pem studio-main .\my-pack-1.0.0.editweave-pack.json
```

2. 서명된 `.editweave-pack.json` 파일을 `release/creator-pack-channel/packs/`에 복사한다. 파일명에는 Pack 버전을 포함한다.
3. 회수할 Pack이 있다면 JSON 배열 형식의 revocations 파일을 준비한다.
4. 카탈로그를 생성한다.

```powershell
node release/create-creator-pack-catalog.mjs release/creator-pack-channel/packs https://packs.example.com "EditWeave Creator Catalog" release/creator-pack-channel/revocations.json release/creator-pack-channel/catalog.unsigned.json
```

5. 네트워크에서 분리된 카탈로그 서명 환경에서 별도의 Ed25519 개인 키로 서명한다.

```powershell
node release/sign-creator-pack-catalog.mjs release/creator-pack-channel/catalog.unsigned.json X:\secure\creator-catalog-private.pem release/creator-pack-channel/catalog.json
```

출력된 공개키와 keyId를 앱 빌드의 `VITE_EDITWEAVE_CREATOR_CATALOG_PUBLIC_KEY`, `VITE_EDITWEAVE_CREATOR_CATALOG_KEY_ID`와 서버 환경 변수에 동일하게 설정한다. 앱 URL은 `VITE_EDITWEAVE_CREATOR_CATALOG_URL=https://packs.example.com/editweave/catalog.json`이다.

## 서버 검증

서버는 시작 및 SIGHUP reload 때 다음을 전부 확인한 새 스냅샷만 채택한다.

- 카탈로그 Ed25519 서명과 keyId
- 카탈로그의 알 수 없는 필드·중복 Pack 버전·항목 제한
- 모든 다운로드 URL의 운영 origin·canonical 경로·버전 포함 파일명
- artifact 실제 파일 크기와 SHA-256
- Pack 내부 SHA-256과 제작자 Ed25519 서명
- Pack ID·이름·버전·제작자·API 범위·카테고리·제작자 키 지문 일치

제공 경로는 `GET /healthz`, `GET|HEAD /editweave/catalog.json`, `GET|HEAD /editweave/packs/<file>`이다. Pack은 immutable cache와 단일 byte range를 지원한다. 실행 중 파일 크기나 수정 시각이 바뀌면 503을 반환하고 reload를 요구한다.

## 실행

`.env.example`을 참고해 환경 변수를 설정한 뒤 저장소 루트에서 실행한다.

```powershell
node services/creator-pack-server/server.mjs
```

컨테이너 배포는 `.env.example`을 `.env`로 복사해 값을 설정하고 다음을 실행한다.

```powershell
docker compose -f services/creator-pack-server/compose.yaml up --build -d
```

TLS 종료와 요청 속도 제한·접근 로그는 Caddy, Cloudflare 또는 동일 역할의 역방향 프록시에서 추가한다. 서버 프로세스에는 카탈로그 공개키와 읽기 전용 채널 볼륨만 제공한다.
