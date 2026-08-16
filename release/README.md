# Cutline release inputs

이 폴더는 배포 서버가 준비되기 전에도 릴리스 입력 형식을 고정하기 위한 자료다.

- `update-manifest.example.json`: 앱의 `VITE_CUTLINE_UPDATE_MANIFEST`가 가리킬 `cutline-update-v1` HTTPS JSON 예시
- `sha256`은 배포할 실제 설치 파일의 64자리 SHA-256으로 교체한다. `schema`, version, Windows/macOS·아키텍처 platform, channel, 날짜, 최소 버전, 안내, URL, SHA-256이 Ed25519 서명 대상이다.
- 운영 앱은 `VITE_CUTLINE_UPDATE_PUBLIC_KEY`의 32-byte Ed25519 공개 키와 `VITE_CUTLINE_UPDATE_KEY_ID`를 고정하고, 일치하는 서명이 없는 매니페스트를 거부한다. 무서명 매니페스트는 localhost 개발에서만 허용한다.
- Windows/macOS 데스크톱은 Rust `ed25519-dalek` 검증 명령을 사용해 WebView 버전과 무관하게 확인하고, 일반 브라우저 개발 화면은 WebCrypto Ed25519를 사용한다.
- 앱은 64KB를 넘는 매니페스트, 리다이렉트, 자격 증명이 포함된 URL, 운영 매니페스트의 localhost 다운로드 URL을 거부한다.
- 운영 배포 서버와 플랫폼별 채널 구조는 `services/update-server/README.md`와 `release/update-channel/README.md`를 따른다. 서버에는 개인 키를 두지 않고 공개 키로 catalog 전체를 검증한다.
- Creator Pack 제작자 서명, catalog 생성·서명과 배포 channel은 `sign-creator-pack.mjs`, `create-creator-pack-catalog.mjs`, `sign-creator-pack-catalog.mjs`, `creator-pack-channel/README.md`, `services/creator-pack-server/README.md`를 따른다. 제작자 키와 catalog 키는 분리하고 둘 다 서버에 두지 않는다.

## 상용화 100% 통합 게이트

- `release/commercial-evidence.example.json`을 `release/commercial-evidence.json`으로 복사하고 라이선스가 확인된 실제 카메라 PQ·HLG, 스마트폰/화면녹화 VFR, ProRes·DNxHR 또는 10-bit 4:2:2 전문 원본, 서명 Windows 설치본 경로를 입력한다.
- macOS 서명·공증·Gatekeeper 설치, HDR 기준 모니터, 사용자 과업, 운영 업데이트·충돌 수집 검증은 `release/measurement-receipt.example.json` 형식의 개별 영수증으로 기록한다. `kind`는 각각 `macos-signed-notarized-install`, `hdr-reference-monitor`, `user-task-validation`, `production-operations`다.
- `pnpm check:commercial`은 FFprobe packet timing과 색 메타데이터/bit depth/코덱, Windows Authenticode 상태와 고정 Subject, 모든 실기기 영수증을 함께 검사한다. 하나라도 없거나 불일치하면 종료 코드 1과 `release/commercial-readiness-report.json`을 남긴다.
- 자동 생성 파일은 실물 미디어 칸에 넣지 않는다. 이 게이트가 `10/10`, `status=pass`일 때만 외부 배포 100%로 판정한다.

## 매니페스트 서명

1. 릴리스 저장소 밖의 안전한 위치에서 `openssl genpkey -algorithm Ed25519 -out cutline-update-private.pem`으로 개인 키를 한 번 생성한다. 개인 키는 소스·CI 로그·배포 서버에 커밋하지 않는다.
2. 예시 JSON을 복사해 실제 버전·URL·SHA-256을 입력하고 `signature`는 제거하거나 기존 값을 무시한다.
3. `node release/sign-update-manifest.mjs release/update-manifest.json <개인키.pem>`을 실행한다. 도구가 같은 파일에 `keyId`와 Base64 서명을 기록하고 앱 빌드에 넣을 공개 키 환경 변수를 출력한다.
4. 출력된 `VITE_CUTLINE_UPDATE_KEY_ID`·`VITE_CUTLINE_UPDATE_PUBLIC_KEY`를 프런트엔드 빌드에 넣고, 같은 공개 키를 Cargo 빌드 환경의 `CUTLINE_UPDATE_PUBLIC_KEY`에도 넣는다. Windows에는 인증서 Subject의 고정 식별 문자열을 `CUTLINE_UPDATE_SIGNER_SUBJECT`, macOS에는 10자리 Team ID를 `CUTLINE_UPDATE_APPLE_TEAM_ID`로 함께 넣는다. 릴리스 Rust 명령은 이 값이 없거나 설치 파일 서명과 다르면 실패 폐쇄한다.
5. 키를 교체하면 새 공개 키를 포함한 앱 버전을 먼저 배포하고 충분한 전환 기간 뒤 매니페스트 서명 키를 바꾼다.

플랫폼별 채널 매니페스트는 `release/create-update-manifest.mjs`로 설치 파일 SHA-256과 URL을 생성한 뒤 위 서명 도구로 서명할 수 있다. 운영 앱의 `VITE_CUTLINE_UPDATE_MANIFEST`는 `/cutline/manifests/<stable|beta>/<platform>.json` 중 현재 빌드 대상 경로를 가리킨다.

## 버전과 CI 빌드 입력

- `pnpm release:set-version -- 1.0.0`은 루트 package, Tauri config와 Cargo package version을 같은 SemVer로 맞춘다. 기존 설치 파일을 새 버전으로 가장하지 않도록 배포 빌드 전에 실행한다.
- GitHub Actions 태그 빌드는 `v`를 제외한 태그 버전을, 수동 빌드는 입력한 version을 위 세 파일에 동기화한다.
- `release/build-desktop.mjs`는 matrix platform과 stable/beta channel에서 플랫폼별 매니페스트 URL을 만들고 같은 공개 키·key ID를 Vite와 Rust 빌드에 동시에 전달한다. origin·키·key ID 중 일부만 설정되면 빌드를 실패시킨다. CI가 생성한 임시 Tauri 서명 config는 `CUTLINE_TAURI_CONFIG`로 전달한다.
- 저장소 변수는 `CUTLINE_UPDATE_ORIGIN`, `CUTLINE_UPDATE_PUBLIC_KEY`, `CUTLINE_UPDATE_KEY_ID`, `CUTLINE_UPDATE_SIGNER_SUBJECT`, `CUTLINE_CRASH_ENDPOINT`를 사용한다.
- Windows Secrets는 Base64 PFX `WINDOWS_CERTIFICATE`와 `WINDOWS_CERTIFICATE_PASSWORD`다. CI는 CurrentUser 인증서 저장소에 가져온 뒤 Subject가 `CUTLINE_UPDATE_SIGNER_SUBJECT`와 정확히 같은지 확인하고, SHA-256/RFC 3161 타임스탬프로 EXE/MSI/NSIS를 서명한다. 세 파일 중 하나라도 Authenticode `Valid`가 아니면 artifact를 업로드하지 않는다.
- macOS Secrets는 `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_KEYCHAIN_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_APP_PASSWORD`, `APPLE_TEAM_ID`다. CI는 Developer ID 서명·공증 뒤 `codesign`, Gatekeeper `spctl`, stapled ticket 검사를 모두 통과해야 DMG/app artifact를 업로드한다.
- Windows와 macOS matrix 모두 패키징 전에 `pnpm check`를 실행한다. 서명·공증 비밀값이 없으면 무서명 설치본을 성공 artifact로 만들지 않고 빌드를 실패시킨다.

- 데스크톱 업데이트 버튼은 현재 OS·CPU와 payload platform이 일치할 때만 사용자가 저장 위치를 고르게 한다. Rust가 서명 payload에서 직접 읽은 HTTPS URL만 최대 2GB까지 `.part`에 다운로드하고 SHA-256 일치 뒤 Windows `Get-AuthenticodeSignature`의 `Valid` 및 허용 Subject, macOS `codesign`/`pkgutil`과 Gatekeeper `spctl` 및 허용 Team ID까지 통과한 파일만 최종 경로로 바꾼다. 30분·1회용 토큰을 발급하며, 사용자가 다시 확인하면 실행 직전 파일 해시와 OS 서명을 재검사한 뒤 EXE/MSI 또는 DMG/PKG를 연다. 브라우저판은 다운로드 페이지만 연다.
- 검증 파일·서명 payload·이전/목표 버전·실행 세션은 로컬에 7일 보존한다. 설치 파일 실행 뒤 다른 앱 세션에서 목표 버전 이상이면 성공으로 정리하고, 10분 유예 뒤에도 이전 버전이면 적용되지 않은 것으로 안내한다. 다음 업데이트 확인에서 기존 파일을 선택하면 Rust가 payload 서명·플랫폼·SHA-256·OS 서명을 모두 다시 검사하고 새 1회 토큰을 발급하므로 네트워크 재다운로드 없이 재시도할 수 있다.
- 설치 프로그램 내부의 자동 교체·롤백은 Tauri updater 서명 키·`.sig` 산출물·운영 배포 서버가 준비된 뒤 연결한다.
- Windows 설치 파일은 코드 서명 인증서, macOS 앱은 Developer ID 서명과 공증이 있어야 외부 배포 완료로 판정한다.
