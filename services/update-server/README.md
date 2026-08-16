# Cutline signed update server

오프라인에서 Ed25519로 서명한 플랫폼별 `cutline-update-v1` 매니페스트와 OS 코드 서명된 설치 파일만 제공하는 무의존성 Node.js 서비스다. 서버에는 업데이트 개인 키가 없으며 시작 전에 공개 키 서명, key ID, 실제 설치 파일 SHA-256·크기·확장자를 모두 확인한다.

## 채널 준비

1. OS 코드 서명과 macOS 공증이 끝난 EXE/MSI/DMG/PKG를 준비한다.
2. immutable 캐시에서 다른 릴리스가 같은 URL을 재사용하지 않도록 전체 버전을 포함한 설치 파일명을 영문·숫자·`._+-`만 사용해 `release/update-channel/artifacts`에 둔다.
3. 저장소 루트에서 아래 명령으로 무서명 매니페스트를 만든다. 기존 파일을 실수로 덮어쓰지 않도록 같은 platform 파일이 있으면 실패한다.

```sh
node release/create-update-manifest.mjs release/update-channel/artifacts/Cutline_1.0.0_windows_x86_64-setup.exe 1.0.0 windows-x86_64 stable https://updates.example.com 0.1.0 "Cutline 1.0 안정화 릴리스"
```

4. 저장소 밖의 Ed25519 개인 키로 해당 JSON을 서명한다.

```sh
node release/sign-update-manifest.mjs release/update-channel/manifests/stable/windows-x86_64.json /secure/cutline-update-private.pem
```

5. 출력된 공개 키와 key ID를 서버 `.env`와 앱 빌드의 `VITE_CUTLINE_UPDATE_PUBLIC_KEY`·`VITE_CUTLINE_UPDATE_KEY_ID`, 같은 공개 키를 Rust 빌드의 `CUTLINE_UPDATE_PUBLIC_KEY`에 넣는다. 앱 빌드의 매니페스트 URL은 플랫폼에 맞는 `https://updates.example.com/cutline/manifests/stable/windows-x86_64.json` 형식으로 설정한다.

입력 구조와 이름 규칙은 `release/update-channel/README.md`에 있다. 개인 키와 코드 서명 인증서는 채널 폴더·배포 서버·컨테이너에 복사하지 않는다.

## 배포

`.env.example`을 `.env`로 복사해 실제 DNS 도메인, 공개 키와 key ID를 설정한 뒤 이 폴더에서 `docker compose up -d --build`를 실행한다. Compose는 채널 폴더를 읽기 전용으로 마운트하고 update server를 외부 포트에 노출하지 않으며 Caddy만 80/443에 공개해 TLS 인증서를 자동 관리한다.

단독 실행은 다음 환경이 필수다.

```sh
CUTLINE_UPDATE_PUBLIC_ORIGIN=https://updates.example.com \
CUTLINE_UPDATE_PUBLIC_KEY=<base64-raw-ed25519-public-key> \
CUTLINE_UPDATE_KEY_ID=<key-id> \
pnpm update:serve
```

상태 확인은 `GET /healthz`다. catalog는 프로세스 시작 때 읽으며 Unix 계열 배포에서는 `SIGHUP`으로 전부 재검증한 새 catalog를 원자 교체할 수 있다. Windows 서비스와 일반 컨테이너 배포는 재시작한다. 기존 catalog가 제공 중일 때 reload 검증이 실패하면 기존 catalog를 유지한다.

## 전달 보장

- 매니페스트는 64KB 이하, `no-store`이며 리다이렉트 없이 제공한다.
- 설치 파일은 최대 2GB이고 `Cache-Control: immutable`, SHA-256 ETag와 `X-Content-SHA256`을 제공한다. Caddy 압축을 사용하지 않아 설치 파일 바이트가 변하지 않는다.
- GET·HEAD와 단일 HTTP byte range를 지원한다. 전체/클라이언트 IP별 동시 다운로드 한도를 초과하면 429와 `Retry-After`를 반환한다.
- 시작 시 확인한 파일 크기나 수정 시각이 바뀌면 503으로 중단하고 catalog reload를 요구한다. 배포 중 파일을 제자리에서 수정하지 말고 완성된 채널 폴더 단위로 교체한다.
- Tauri 기본 origin만 CORS 허용하며 자격 증명은 사용하지 않는다. 프록시가 외부 `X-Forwarded-For`를 제거하고 직접 설정할 때만 trust proxy를 켠다.
