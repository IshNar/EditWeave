# 10. 구현 근거 매트릭스

## 목적

긴 개발 대화의 기억이나 이전 완료 보고가 아니라 현재 작업 폴더의 소스와 실제 사용자 검증을 근거로 EditWeave의 상태를 판정한다. 이 문서는 `08-production-completion-plan.md`의 상세 요구를 실무 흐름 단위로 묶은 색인이며, 소스 파일이 있다는 사실만으로 출시 완료를 선언하지 않는다.

## 상태 표기

- `소스`: 현재 소스에서 연결 경로를 확인했다. 실행 성공을 뜻하지 않는다.
- `부분`: 경로는 있으나 알려진 기능 공백 또는 근사 처리가 남았다.
- `검증 대기`: 실제 파일·장시간 재생·출력 또는 사용자 장비 증거가 필요하다.
- `외부 조건`: 인증서, macOS 장비, DNS/TLS 또는 운영 인프라가 필요하다.
- `검증 완료`: 사용자가 해당 조건과 재현 절차를 통과했다고 확인한 경우에만 사용한다.

현재 전체 요구 행을 `검증 완료`로 판정한 실무 흐름은 없다. 개발 과정의 자동·로컬 런타임 검증과 실제 배포 장비·외부 인프라 검증을 분리하고, 각 행의 완료 조건을 모두 충족하기 전에는 출시 완료로 승격하지 않는다.

## 요구사항별 근거

| ID | 요구사항 | 현재 상태 | 현재 소스 근거 | 완료에 필요한 추가 증거 |
| --- | --- | --- | --- | --- |
| M1 | 브라우저 선택·HTML 드롭·Tauri 경로 드롭과 실제 미디어 등록 | 소스 / 검증 대기 | `src/App.tsx`, `src/components/MediaPanel.tsx`, `src/platform/projectFiles.ts`, `src/platform/mediaSource.ts` | MP4/MOV/MP3/PNG 각각 선택·HTML/Tauri 드롭 등록, 다중 선택 일부 경로 실패/미지원 형식과 성공 지속, 동일 파일 이중 이벤트 중복 제거, 분석 실패 재선택 stable ID 재사용, 재실행 후 경로 복원 |
| M2 | 메타데이터·파형·sample peak·VFR·HDR·TC/릴 분석 | 소스 / 검증 대기 | `src/media/analyze.ts`, `src/media/timecode.ts`, `src-tauri/src/quicktime_timecode.rs` | 스마트폰 VFR, QuickTime TC, 5.1, PQ/HLG 원본 비교 |
| M3 | 대용량 원본 범위 읽기와 영속 프록시 | 소스 / 검증 대기 | `src/platform/mediaSource.ts`, `src/media/proxy.ts`, `src/platform/proxyCache.ts` | 1.5GB 이상 원본의 메모리·취소·재연결·원본 출력 확인 |
| P1 | 프로젝트 저장·열기·자동 저장 이력·원본 재연결 | 소스 / 검증 대기 | `src/editor/project.ts`, `src/platform/projectFiles.ts`, `src/App.tsx` | 같은 프로젝트 전체 복원/분기의 live File·Object URL·프록시 유지, 병합/다른 프로젝트의 변경 원본만 오프라인 전환, 종료·재실행·수동 재연결·저장소 초과 회귀 |
| P2 | 빈 시퀀스 생성·이름 변경·독립 복제·의존성 보호 삭제 | 소스 / 검증 대기 | `src/editor/sequenceManagement.ts`, `src/components/SequenceManagerDialog.tsx`, `src/components/Topbar.tsx`, `src/App.tsx` | 현재 규격 빈 시퀀스 생성, 활성 편집 보존, 중첩·쇼츠·멀티캠·ADR 포함 복제 뒤 ID/참조 무결성, 원본/복제본 독립 편집, 마지막/중첩/파생/외부 ADR/병합/렌더/LAN/열린 ADR 사용 중 삭제 차단, 허용 삭제 뒤 미디어·디스크 원본 보존과 저장·재열기 |
| E1 | 멀티트랙 대상 지정·삽입/덮어쓰기·이동·분할·리플/롤/슬립/슬라이드 | 소스 / 검증 대기 | `src/editor/trackTargeting.ts`, `src/editor/rippleInsert.ts`, `src/editor/rippleDelete.ts`, `src/editor/overwrite.ts`, `src/editor/trimConstraints.ts`, `src/editor/timelineOps.ts`, `src/editor/project.ts`, `src/components/Timeline.tsx`, `src/App.tsx` | V/A/T 대상과 트랙 선택 독립성, 전체 대상 해제 차단, 새 트랙 대상 이전·대상 삭제 복구·시퀀스 전환/저장/재열기. 삽입/삭제/리플 트림 축소·확장의 횡단 클립 속도/자동화/단어 자막 재단과 이후 트랙 자동화·마커·검토 삭제 ID·대본/단어·제안·ADR 동시 이동, 오른쪽 링크·그룹 독립 이동, 바깥 전환/fade 보존, 잠금 트랙 제외와 ADR 겹침/누락/시간 불일치/잠금 차단. 일반/리플 확장은 영상·오디오 자산 실제 길이와 중첩 시퀀스 길이의 원본 핸들을 넘지 않고 같은 편집점의 링크 V/A를 함께 변경해야 한다. 슬립은 속도 곡선·역재생 source offset 범위의 링크 교집합, 롤/슬라이드는 모든 링크 트랙의 맞닿은 이웃과 최소 길이·원본 핸들·잠금·ADR 차단을 실제 영상/오디오 조합에서 확인한다. 덮어쓰기의 대상 트랙만 재단·시간축 불변·ADR 보호. 전체 Undo/Redo와 30분 프로젝트 마우스·단축키 편집 회귀 |
| E2 | 소스 I/O·3점 편집·J/L 컷·링크/그룹·중첩·멀티캠 | 소스 / 검증 대기 | `src/App.tsx`, `src/editor/nesting.ts`, `src/editor/audioSync.ts` | 복수 카메라·레코더 실제 파일과 중첩 경계 회귀 |
| E3 | 속도 램프·역재생·정지 프레임의 영상/오디오/출력 공통 시간 매핑 | 소스 / 검증 대기 | `src/editor/effects.ts`, `src/editor/nesting.ts`, `src/media/audioPcm.ts`, `src/media/timeMappedAudioPreview.ts`, `src/media/export.ts`, `src/components/PreviewPanel.tsx` | 정·역방향 미리보기와 출력은 공통 source-time과 상관 정렬 granular pitch-preserve PCM을 사용한다. 일정/가변 속도·탐색·프록시·청크 경계 비교 필요 |
| E4 | 장시간 재생 헤드와 미디어 A/V 동기화 | 소스 / 검증 대기 | `src/App.tsx`, `src/components/PreviewPanel.tsx` | monotonic 시계, 외부 탐색 재기준화, 정지 프레임 seek, drift 보정 소스 확인. 10/30/60분 실제 재생 측정 필요 |
| V1 | 변형·색보정·곡선·Qualifier·노드·마스크·추적·합성 | 소스 / 검증 대기 | `src/editor/effects.ts`, `src/editor/colorCurves.ts`, `src/editor/colorNodes.ts`, `src/editor/mask.ts`, `src/media/export.ts` | 미리보기/SDR MP4 픽셀 비교와 효과 조합 회귀 |
| A1 | clip/track gain·pan·EQ·gate·Dynamics·정규화 | 소스 / 검증 대기 | `src/editor/effects.ts`, `src/editor/audioDsp.ts`, `src/components/PreviewPanel.tsx`, `src/media/export.ts` | mono/stereo/5.1 식별 신호와 preview/export 레벨·주파수 비교 |
| A2 | 역할 버스·Aux·삽입 체인·실제 master L/R 미터 | 소스 / 검증 대기 | `src/editor/audioBuses.ts`, `src/components/AudioMixerDialog.tsx`, `src/components/PreviewPanel.tsx`, `src/media/export.ts` | 겹친 클립과 Aux에서 Dynamics·meter·최종 출력 비교 |
| A3 | ADR 녹음·영속 테이크·큐·컴핑 | 소스 / 검증 대기 | `src/components/VoiceoverDialog.tsx`, `src/platform/recordingStore.ts`, `src/editor/delivery.ts`, `src/App.tsx` | 실제 마이크 권한·재실행·테이크 전환·구간 컴프, 일반 미디어 제거의 ADR 참조 차단, 공유 녹음 자산을 재사용한 뒤 한 큐 삭제, 활성/중첩 출력 그래프의 원본·트랙·클립·컴프 무결성 Delivery Guard 확인 |
| C1 | Whisper·SRT/VTT·화자·단어 강조·대본 편집 | 소스 / 검증 대기 | `src/ai/transcribe.ts`, `src/transcript/subtitles.ts`, `src/components/TranscriptCutDialog.tsx` | 긴 한국어 원본의 정확도·취소·캐시·자막 출력 확인 |
| S1 | 9:16/4:5/1:1 쇼츠 파생·자동 리프레임·원본 영향 추적 | 소스 / 검증 대기 | `src/shorts/generate.ts`, `src/editor/sourceGraph.ts`, `src/components/ShortsDialog.tsx` | 롱폼 수정 후 파생 갱신과 복수 쇼츠 출력 확인 |
| O1 | 멀티레이어 H.264/H.265 MP4와 자막·오디오 합성 | 소스 / 검증 대기 | `src/media/export.ts`, `src/components/ExportDialog.tsx` | 각 코덱/해상도/fps 실제 재생, duration, A/V sync, 파일 크기 확인 |
| O2 | PQ/HLG Main10·RGBA16F·HDR 메타데이터 | NSIS 합성 실출력 통과 / 외부 계측 대기 | `src/media/hdr10.ts`, `src/media/hdrRawTransform.ts`, `src/media/hdrLinearCompositor.ts`, `src/media/export.ts`, `src/platform/renderSegments.ts`, `src-tauri/src/lib.rs`, `src-tauri/src/hdr_metadata.rs` | 새 NSIS 격리 설치본에서 PQ·HLG 각 60초 Main10/BT.2020/transfer/1,800프레임/전 디코드 통과. 실제 HDR 원본·휘도·기준 모니터·메타데이터 외부 계측 필요 |
| O3 | 파일 직접 스트리밍·30초 체크포인트·재개·결합 | 소스 / 검증 대기 | `src/platform/renderSegments.ts`, `src/platform/renderRecovery.ts`, `src/media/mergeSegments.ts` | 앱 강제 종료 후 재개, 30/60초 경계 프레임·오디오 연속성 |
| D1 | Delivery Guard와 완성 파일 EBU R128 측정 | 소스 / 검증 대기 | `src/editor/delivery.ts`, `src/platform/loudness.ts` | 완성 MP4 실측값과 외부 측정기 비교 |
| X1 | FCPXML·CMX3600 EDL·검토 패키지/링크 | 소스 / 검증 대기 | `src/editor/exchange.ts`, `src/editor/reviewPackage.ts`, `src-tauri/src/lan_review.rs` | Premiere/Resolve 왕복과 다른 장치 LAN 검토 확인 |
| X2 | 공통 체크포인트 기반 프로젝트 3-way 병합·영속 결정·무손실 충돌 분기 | 소스 / 검증 대기 | `src/editor/versionMerge.ts`, `src/editor/project.ts`, `src/components/ProjectHistoryDialog.tsx`, `src/editor/delivery.ts`, `src/App.tsx` | 두 복제 프로젝트에서 클립·트랙·시퀀스 메타·대본·제안·마커·버스·ADR·미디어·사전의 양쪽 수정/삭제, 현재↔상대 재결정, 같은 미디어의 로컬 핸들 보존과 다른 미디어 오프라인 재연결, 참조 중 삭제 차단, nested/ADR/group/link 의존성, 검토 마커·Delivery Guard·세션 저장/재열기 비교 |
| R1 | 충돌 보고·업데이트 배포 서버와 클라이언트 검증 | 소스 / 외부 조건 | `src/platform/crashReport.ts`, `src/platform/update.ts`, `services/crash-collector`, `services/update-server` | 실제 HTTPS·암호화 볼륨·공개 키·보존 정책 배포 |
| R2 | Windows/macOS 설치·서명·공증·업데이트 | 외부 조건 / 검증 대기 | `src-tauri`, `release`, `.github/workflows` | 최신 MSI/NSIS/DMG 빌드, Authenticode, Developer ID, 공증과 설치/제거/업데이트 |

## 2026-08-09 유한 정적 소스 연결 감사

- 요구 행은 M1~R2까지 23개다. 이전 진행 보고에서 22개라고 표현한 것은 계산 오류였으며, 이후 완료율이나 남은 범위는 이 문서의 실제 23개 행만 기준으로 한다.
- 사용자 요청에 따라 앱 실행·자동 테스트·타입 검사·빌드·패키징 없이 정적 연결만 감사했다. 표에 인용된 소스·서비스·릴리스 경로 62개는 현재 작업 폴더에 모두 존재한다. 이 사실은 경로 누락을 배제할 뿐 런타임 성공을 증명하지 않는다.
- M1~S1은 `App`/패널의 사용자 명령에서 미디어 분석·프록시, 저장/자동 저장·시퀀스 관리, 타임라인/중첩/공통 source-time, 미리보기 효과·오디오 버스, 전사/자막과 쇼츠 파생 함수 호출까지 연결되어 있다. 이번 감사에서 발견된 E1의 원본 핸들·링크 고급 트림 공백은 `trimConstraints.ts`와 `trimTimelineClipAdvancedResult`로 수정하고 호출 경로·문서를 함께 갱신했다.
- O1~D1은 출력 창→`startExport`/쇼츠 일괄 출력→`exportSequence`, HDR Main10/RGBA16F 합성·메타데이터, 30초 구간 체크포인트·복구·결합, Delivery Guard와 완성 파일 EBU R128 네이티브 측정까지 연결되어 있다.
- X1~R1은 FCPXML/EDL·검토 패키지/LAN 검토, 3-way 병합·충돌 결정·프로젝트 lock heartbeat, 전역 오류 경계/동의형 충돌 큐, Ed25519 업데이트 검증·다운로드·재실행과 두 운영 서비스까지 호출 경로가 있다. R2의 최신 Windows 로컬 설치본 검증은 완료됐고 실제 코드 서명·공증은 자격 증명과 플랫폼 장비가 필요한 외부 조건으로 남는다.
- 이 감사에서 E1 수정 이후 추가로 끊어진 UI→엔진 호출은 정적으로 발견되지 않았다. 현재 개발 범위는 단계별 후보가 아닌 전체 출시 제품이며, 기능 공백이 있으면 같은 출시 소스에서 계속 구현한다.

## 현재 알려진 출시 차단 공백

1. Windows x64 MSI/NSIS는 2026-08-15 소스로 재패키징했고 NSIS 격리 경로 무인 설치·60분 렌더·강제 종료 복구·제거를 통과했다. MSI 관리자 설치는 검증 전이며 EXE/MSI/NSIS 모두 Authenticode가 `NotSigned`, 실제 업데이트도 검증 전이다. macOS Apple Silicon 설치본은 실제 장비에서 빌드·서명·공증·검증해야 한다.
2. 60분 합성 설치본 출력과 합성 PQ/HLG Main10 60초 출력은 통과했지만 실제 장비 VFR/HDR/전문 코덱 원본의 A/V sync·탐색·GPU·휘도·오디오 장치 클록은 사용자 검증 전이다.
3. 운영 업데이트·충돌 수집 서비스는 코드만 존재하며 실제 DNS/TLS/저장 볼륨과 연결되지 않았다.
4. CI는 Windows Authenticode와 macOS Developer ID·공증 비밀값을 필수 출시 게이트로 구성했지만, 현재 작업 환경에는 실제 인증서·Apple 자격 증명이 없어 원격 서명 빌드 결과는 아직 없다.

## 2026-08-09 전체 출시 검증 진행 증거

- `pnpm check`: TypeScript, Vitest 12개 파일 41개 테스트, Vite production build, Rust `cargo check` 통과.
- 편집 엔진 회귀: 소스 트랙 대상 지정, 리플 삽입·삭제 시 마커/대본 단어/제안 동기화, 실제 소스 길이 기반 일반 트림·슬립 한계, 역재생 핸들, 이미지·중첩 길이, 오디오 DSP/버스, Delivery Guard, 프로젝트 JSON 왕복·재연결, 시퀀스 복제 ID 및 참조 무결성·삭제 보호를 자동 검증.
- 합성 타임라인 성능 기준: 10분/1,200클립 2.14ms, 30분/3,600클립 3.05ms, 60분/7,200클립 4.46ms에 1.25초 리플 삭제와 JSON 직렬화를 완료했다. 이는 순수 데이터 연산 기준이며 실제 장시간 디코딩·재생·GPU·메모리 검증을 대체하지 않는다.
- 로컬 런타임 스모크: MP4/MP3/PNG 가져오기·분석, 미지원 SVG 거부, 빈 시퀀스 생성, MP4 배치, 5.06초 실제 MP4를 720×1280 H.264 SDR 30fps로 출력하고 영속 렌더 큐에서 100% 완료 확인.
- NSIS 설치 스모크: 작업 폴더 아래 격리 경로에 무인 설치(종료 코드 0), 설치된 EXE 8초 기동, 무인 제거(종료 코드 0), 설치 폴더와 HKCU 제거 항목 정리를 확인했다.
- 2026-08-15 NSIS 장시간 실물: 설치된 EXE와 번들 FFmpeg·FFprobe로 60분 108,000프레임을 출력했다. 26/120 체크포인트 뒤 강제 종료해 정상 구간 26개를 복구하고 0바이트 부분 구간을 거부했으며, 전체 디코드 오류 0·SSIM 0.976030·8개 PCM 창 지연 0ms·512MiB 힙 방어선을 통과했다.
- 2026-08-15 HDR 원본·효과 실물: Chromium `format=null` Main10 조건에서 네이티브 원본 디코드 fallback을 제품 일반 내보내기에 연결했다. PQ/HLG 중립 60초는 SSIM 0.999636/0.999711을 통과했다. WGSL `target` 예약어로 효과 출력이 검정이던 결함은 컴파일 fail-fast와 변수명 수정으로 차단했고, 리브랜딩 전 NSIS 설치본 PQ +0.5 노출 900프레임은 YAVG 378.774·디코드 오류 0을 통과했다. 해당 NSIS는 74,870,003바이트, SHA-256 `014CD37E7D9CAD6E41D1B61EEBBD22277644391B31516259DDCB06C8B575D443`, Authenticode `NotSigned`다.
- 2026-08-18 EditWeave 리브랜딩: 앱·Tauri ID·Rust crate/실행 파일·프로젝트/Pack/업데이트 schema·서비스 환경변수·문서·아이콘을 EditWeave로 통일하고 기존 Cutline 로컬 저장 키와 프로젝트 구조를 읽는 마이그레이션을 추가했다. `editweave.exe`와 MSI/NSIS를 실제 패키징했으며 NSIS는 74,718,655바이트, SHA-256 `3703745EAC25F75EFD24E2F73E10D683ADEE9B95FF023CBD82F2BE6004A4438B`, Authenticode `NotSigned`다.
- 2026-08-15 상용화 통합 게이트: `release/check-commercial-readiness.mjs`가 실제 10-bit BT.2020 PQ/HLG, 240 packet 내 duration 변동 VFR, 전문 코덱, Windows Authenticode 고정 Subject, macOS 서명·공증 설치, HDR 기준 모니터, 사용자 과업, 운영 인프라 영수증을 10개 fail-closed 항목으로 판정한다. 순수 판정 회귀 4개는 통과했고 증거가 없는 현재 환경에서는 의도대로 `blocked`다.
- 로컬 다운로드 폴더의 `[4K HDR]` 표기 MOV/MP4 3개를 FFprobe로 확인했으나 모두 640×272 H.264 8-bit BT.709 CFR이었다. 이름만 HDR인 파일은 실물 증거로 승격하지 않았다.
- AAC 5.1 fallback 실물: WebView 6채널 AAC 미지원 시 연속 24-bit 5.1 WAV를 생성하고 번들 FFmpeg로 영상에 원자적 결합한다. 실제 Tauri 60초 MP4가 AAC 48kHz 6ch `5.1`, 센터 전용 대사·다른 채널 0·경계 지연 0샘플·전 구간 디코드 오류 0을 통과했다.
- HDR Main10 fallback 실물: WebView HEVC Main10 미지원 시 WebGPU `I420P10`을 체크포인트별 `yuv420p10le`로 스트리밍하고 번들 `libx265`로 인코딩한다. 실제 Tauri PQ·HLG 각 60초 MP4가 Main 10·BT.2020-NCL·limited-range·올바른 transfer·1,800프레임·전 구간 디코드 오류 0을 통과했다.
- 위 증거는 해당 합성 경로의 기본 동작을 입증하지만 실제 장비 VFR/HDR/전문 카메라 원본, 기준 HDR 모니터·외부 분석기, MSI 관리자 설치·서명·업데이트, macOS와 운영 인프라 조건까지 대체하지 않는다.

## 갱신 규칙

- 기능을 수정한 작업은 해당 행의 소스 근거와 알려진 공백을 함께 갱신한다.
- 사용자 검증 결과는 사용한 파일 형식·길이·OS·절차와 함께 `troubleshooting.md`에 기록한 뒤 상태를 바꾼다.
- 검색 결과, 버튼 존재, 타입 정의, 계획 문장만으로 `검증 완료`를 표시하지 않는다.
- Top 3의 모든 세부 기능과 생태계를 완전히 대체한다는 표현은 사용하지 않는다. EditWeave 전체 제품 완료는 이 표의 실무 흐름과 `08-production-completion-plan.md`의 출시 조건을 충족했을 때만 선언한다.
