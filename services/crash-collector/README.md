# EditWeave crash collector

사용자가 앱에서 익명 오류 전송에 명시적으로 동의했을 때만 보내는 `editweave-crash-v1` JSON을 받는 무의존성 Node.js 서비스다. 리포트는 날짜별 JSONL로 기록하고 IP 주소·쿠키·요청 헤더는 저장하지 않는다.

## 실행과 배포

Node.js 22 이상에서 저장소 루트의 `pnpm crash:serve`로 실행할 수 있다. 기본 주소는 `127.0.0.1:8787`, 수집 경로는 `POST /api/editweave/crashes`, 상태 확인은 `GET /healthz`, 데이터는 `var/crash-reports`에 저장된다.

컨테이너 배포 예시는 다음과 같다.

```sh
docker build -t editweave-crash-collector services/crash-collector
docker run --read-only --tmpfs /tmp --restart unless-stopped \
  -p 127.0.0.1:8787:8787 \
  -v editweave-crashes:/data \
  -e EDITWEAVE_CRASH_ALLOWED_ORIGINS=tauri://localhost,http://tauri.localhost,https://tauri.localhost \
  editweave-crash-collector
```

HTTPS까지 함께 구성하려면 `.env.example`을 `.env`로 복사해 실제 DNS 도메인과 정책 값을 채우고 이 폴더에서 `docker compose up -d --build`를 실행한다. `compose.yaml`은 collector를 외부 포트에 노출하지 않고 Caddy만 80/443에 공개하며 인증서를 자동 발급한다. DNS A/AAAA 레코드는 먼저 해당 서버를 가리켜야 한다. `.env`는 저장소에 커밋하지 않는다.

인터넷에는 이 포트를 직접 노출하지 않고 Caddy, nginx 또는 관리형 로드밸런서 뒤에서 HTTPS 경로만 공개한다. 프록시가 외부 요청 헤더를 제거하고 신뢰할 수 있는 `X-Forwarded-For`를 새로 설정할 때만 `EDITWEAVE_CRASH_TRUST_PROXY=1`을 사용한다. 앱 빌드의 `VITE_EDITWEAVE_CRASH_ENDPOINT`에는 최종 HTTPS URL을 넣는다.

## 환경 변수

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `EDITWEAVE_CRASH_HOST` | `127.0.0.1` | 수신 주소 |
| `EDITWEAVE_CRASH_PORT` | `8787` | 수신 포트 |
| `EDITWEAVE_CRASH_DATA_DIR` | `var/crash-reports` | JSONL 저장 폴더 |
| `EDITWEAVE_CRASH_RETENTION_DAYS` | `30` | 보존 일수, 1~365일 |
| `EDITWEAVE_CRASH_MAX_STORAGE_MB` | `512` | 전체 저장 상한, 16~102400MB |
| `EDITWEAVE_CRASH_MAX_BODY_KB` | `32` | 단일 요청 상한, 8~128KB |
| `EDITWEAVE_CRASH_RATE_LIMIT_PER_MINUTE` | `60` | IP별 메모리 속도 제한 |
| `EDITWEAVE_CRASH_ALLOWED_ORIGINS` | Tauri 기본 origin 3개 | 쉼표로 구분한 허용 origin |
| `EDITWEAVE_CRASH_TRUST_PROXY` | `0` | 신뢰 프록시의 전달 IP 사용 여부 |

서버는 알 수 없는 필드, 잘못된 UUID·시각·스키마, 과도한 문자열과 요청을 거부한다. 같은 리포트 ID는 프로세스 재시작 후에도 보존 파일을 인덱싱해 중복 기록하지 않는다. 기록은 단일 쓰기 큐로 직렬화하고 30일 또는 용량 상한을 넘은 가장 오래된 일자 파일을 제거한다.

## 운영 정책

- 저장 볼륨은 운영 담당자만 읽을 수 있게 암호화·접근 제어하고 공개 웹 경로로 제공하지 않는다.
- JSONL 백업을 만들 경우 원본과 같은 보존 기간을 적용한다.
- 서버 로그에는 리포트 본문과 IP를 남기지 않는다. ID, 오류 종류, 앱 버전과 비식별 fingerprint만 기록한다.
- 리포트에는 계정 식별자가 없으므로 사용자별 검색·프로파일링 용도로 사용하지 않는다.
- 장애 분류 후 필요한 수정이 릴리스되면 원본 리포트를 보존 기간보다 일찍 삭제할 수 있다.
