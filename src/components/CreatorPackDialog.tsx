import { Ban, Download, PackageCheck, RefreshCw, Search, ShieldAlert, ShieldCheck, Upload, X } from 'lucide-react'
import { useRef, useState } from 'react'
import {
  assessCreatorPackInstall,
  assessCreatorPackTrust,
  createCreatorPack,
  installCreatorPack,
  parseCreatorPack,
  readInstalledCreatorPacks,
  serializeCreatorPack,
  setCreatorPackPublisherTrust,
  uninstallCreatorPack,
  type CreatorPack,
} from '../platform/creatorPacks'
import {
  creatorPackCatalogConfigured,
  downloadCatalogCreatorPack,
  findInstalledPackRevocations,
  loadConfiguredCreatorPackCatalog,
  parseCreatorPackCatalog,
  searchCreatorPackCatalog,
  type CreatorPackCatalog,
  type CreatorPackCatalogEntry,
} from '../platform/creatorPackCatalog'

export function CreatorPackDialog({ open, onClose, onNotice }: { open: boolean; onClose: () => void; onNotice: (message: string) => void }) {
  const [name, setName] = useState('내 채널 Creator Pack')
  const [publisher, setPublisher] = useState('EditWeave 사용자')
  const [pending, setPending] = useState<CreatorPack | undefined>()
  const [installed, setInstalled] = useState(() => readInstalledCreatorPacks())
  const [catalog, setCatalog] = useState<CreatorPackCatalog | undefined>()
  const [catalogQuery, setCatalogQuery] = useState('')
  const [catalogBusy, setCatalogBusy] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()
  const inputRef = useRef<HTMLInputElement>(null)
  const catalogInputRef = useRef<HTMLInputElement>(null)
  if (!open) return null

  const counts = pending ? [pending.contents.motionTemplates.length, pending.contents.speedTemplates.length, pending.contents.audioTemplates.length, pending.contents.titleStyleTemplates.length, pending.contents.transitionPresets.length, pending.contents.exportPresets.length] : undefined
  const trust = pending ? assessCreatorPackTrust(pending) : undefined
  const decision = pending ? assessCreatorPackInstall(pending, installed) : undefined
  const installBlocked = trust?.status === 'blocked' || trust?.status === 'key-changed' || decision?.status === 'downgrade' || decision?.status === 'publisher-key-changed'
  const catalogResults = catalog ? searchCreatorPackCatalog(catalog, catalogQuery, installed).slice(0, 50) : []
  const revokedInstalled = catalog ? findInstalledPackRevocations(catalog, installed) : []

  const download = async () => {
    try {
      const pack = createCreatorPack(name, publisher)
      const url = URL.createObjectURL(new Blob([await serializeCreatorPack(pack)], { type: 'application/json' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${pack.name.replace(/[\\/:*?"<>|]/g, '-')}.editweave-pack.json`
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
      onNotice(`Creator Pack을 내보냈습니다: 모션 ${pack.contents.motionTemplates.length} · 속도 ${pack.contents.speedTemplates.length} · 오디오 ${pack.contents.audioTemplates.length} · 타이틀 ${pack.contents.titleStyleTemplates.length} · 전환 ${pack.contents.transitionPresets.length} · 출력 ${pack.contents.exportPresets.length}`)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Creator Pack을 내보내지 못했습니다.') }
  }

  const read = async (file?: File) => {
    if (!file) return
    try {
      setPending(await parseCreatorPack(await file.text()))
      setError(undefined)
    } catch (caught) {
      setPending(undefined)
      setError(caught instanceof Error ? caught.message : 'Creator Pack을 읽지 못했습니다.')
    }
  }

  const readCatalog = async (file?: File) => {
    if (!file) return
    try {
      const parsed = await parseCreatorPackCatalog(await file.text(), { allowUnsignedLocal: true })
      setCatalog(parsed)
      setError(undefined)
      onNotice(`로컬 Creator Pack 카탈로그 ${parsed.entries.length}개 항목을 불러왔습니다. 카탈로그 자체는 미신뢰이며 각 Pack을 별도로 검증합니다.`)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Creator Pack 카탈로그를 읽지 못했습니다.') }
  }

  const refreshCatalog = async () => {
    setCatalogBusy('catalog')
    try {
      const parsed = await loadConfiguredCreatorPackCatalog()
      setCatalog(parsed)
      setError(undefined)
      onNotice(`서명된 Creator Pack 카탈로그를 확인했습니다: ${parsed.entries.length}개 Pack`)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Creator Pack 카탈로그를 확인하지 못했습니다.') }
    finally { setCatalogBusy(undefined) }
  }

  const downloadCatalogPack = async (entry: CreatorPackCatalogEntry) => {
    setCatalogBusy(`${entry.packId}@${entry.version}`)
    try {
      const pack = await downloadCatalogCreatorPack(entry)
      setPending(pack)
      setError(undefined)
      onNotice(`${pack.name} v${pack.version}의 SHA-256·제작자 서명·키 지문을 확인했습니다. 설치 전 내용을 검토하세요.`)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Creator Pack을 안전하게 다운로드하지 못했습니다.') }
    finally { setCatalogBusy(undefined) }
  }

  const install = (trustPublisher = false) => {
    if (!pending) return
    try {
      if (installBlocked) throw new Error(decision?.status === 'downgrade' ? `설치된 v${decision.installedVersion}보다 낮은 버전은 설치할 수 없습니다.` : '제작자 키 안전 정책으로 설치를 차단했습니다.')
      if (trustPublisher) setCreatorPackPublisherTrust(pending, 'trusted')
      const result = installCreatorPack(pending)
      onNotice(`Creator Pack ${decision?.status === 'upgrade' ? '업데이트' : '설치'} 완료 · 모션 ${result.motionTemplates} · 속도 ${result.speedTemplates} · 오디오 ${result.audioTemplates} · 타이틀 ${result.titleStyleTemplates} · 전환 ${result.transitionPresets} · 출력 ${result.exportPresets}개 추가`)
      setInstalled(readInstalledCreatorPacks())
      setPending(undefined)
      setError(undefined)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Creator Pack을 설치하지 못했습니다.') }
  }

  const blockPublisher = () => {
    if (!pending) return
    try {
      setCreatorPackPublisherTrust(pending, 'blocked')
      setError('이 제작자 키를 차단했습니다. 같은 키로 서명된 Pack은 설치할 수 없습니다.')
    } catch (caught) { setError(caught instanceof Error ? caught.message : '제작자 키를 차단하지 못했습니다.') }
  }

  const trustPublisherAgain = () => {
    if (!pending) return
    try {
      setCreatorPackPublisherTrust(pending, 'trusted')
      setError('이 제작자 키를 다시 신뢰했습니다. Pack 내용을 검토한 뒤 설치하세요.')
    } catch (caught) { setError(caught instanceof Error ? caught.message : '제작자 키를 신뢰하지 못했습니다.') }
  }

  const uninstall = (packId: string) => {
    try {
      const result = uninstallCreatorPack(packId)
      setInstalled(readInstalledCreatorPacks())
      onNotice(`Creator Pack 제거 완료 · ${result.removed}개 제거${result.preservedModified ? ` · 수정된 ${result.preservedModified}개 보존` : ''}`)
      setError(undefined)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Creator Pack을 제거하지 못했습니다.') }
  }

  const trustLabel = trust?.status === 'trusted' ? '신뢰한 제작자'
    : trust?.status === 'blocked' ? '차단한 제작자'
      : trust?.status === 'key-changed' ? '같은 keyId의 공개키 변경 감지'
        : trust?.status === 'untrusted' ? '서명 유효 · 아직 신뢰하지 않은 제작자'
          : pending?.verification?.integrity === 'verified' ? 'SHA-256 확인 · 미서명' : '레거시 v1 · 미서명'
  const decisionLabel = decision?.status === 'upgrade' ? `v${decision.installedVersion}에서 업데이트`
    : decision?.status === 'downgrade' ? `설치된 v${decision.installedVersion}보다 낮아 차단`
      : decision?.status === 'reinstall' ? '동일 버전 재설치'
        : decision?.status === 'publisher-key-changed' ? '설치 기록과 제작자 키가 달라 차단'
          : '새 Pack'

  return <div className="modal-backdrop"><section className="creator-pack-dialog" role="dialog" aria-modal="true" aria-labelledby="creator-pack-title">
    <header><div><span className="eyebrow">DECLARATIVE EXTENSION</span><h2 id="creator-pack-title">Creator Pack</h2></div><button className="icon-button" onClick={onClose} aria-label="닫기"><X size={17} /></button></header>
    <section className="pack-security"><ShieldCheck size={18} /><div><strong>코드 실행 없는 안전한 확장</strong><small>네트워크·파일 권한을 허용하지 않습니다. SHA-256과 Ed25519를 검증하고, 신뢰한 제작자 공개키 지문을 설치 기록에 고정해 키 바꿔치기와 다운그레이드를 차단합니다.</small></div></section>
    <section className="pack-export"><h3>내 템플릿 묶음 공유</h3><div><input value={name} maxLength={100} onChange={(event) => setName(event.target.value)} placeholder="Pack 이름" /><input value={publisher} maxLength={100} onChange={(event) => setPublisher(event.target.value)} placeholder="제작자" /><button onClick={() => void download()}><Download size={13} /> 전체 사용자 템플릿 내보내기</button></div></section>
    <section className="pack-import pack-catalog"><h3>Pack 카탈로그</h3>
      <input ref={catalogInputRef} hidden type="file" accept=".json,application/json" onChange={(event) => { void readCatalog(event.target.files?.[0]); event.target.value = '' }} />
      <div className="pack-catalog-toolbar"><label><Search size={13} /><input value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} placeholder="Pack·제작자·카테고리 검색" /></label><button onClick={() => catalogInputRef.current?.click()}><Upload size={13} /> 로컬 카탈로그</button>{creatorPackCatalogConfigured() && <button disabled={catalogBusy === 'catalog'} onClick={() => void refreshCatalog()}><RefreshCw size={13} /> 공식 카탈로그</button>}</div>
      {catalog && <p className="pack-catalog-source">{catalog.authority} · {catalog.verification === 'signed' ? '운영 서명 검증됨' : '로컬 미신뢰 카탈로그'} · {catalog.entries.length}개</p>}
      {revokedInstalled.map(({ installed: pack, revocation }) => <article className="pack-revoked" key={`${pack.id}-${revocation.publishedAt}`}><ShieldAlert size={20} /><div><strong>{pack.name} v{pack.version} 회수 경고</strong><p>{revocation.reason}</p><span>{revocation.publishedAt}</span></div><button className="danger" onClick={() => uninstall(pack.id)}>안전 제거</button></article>)}
      {catalogResults.map(({ entry, status, installedVersion }) => <article className={status === 'revoked' ? 'pack-revoked' : undefined} key={`${entry.packId}-${entry.version}`}><PackageCheck size={20} /><div><strong>{entry.name} <small>v{entry.version}</small></strong><p>{entry.publisher} · {entry.categories.join(' · ')}</p><span>{status === 'revoked' ? '카탈로그에서 회수됨' : status === 'update' ? `v${installedVersion}에서 업데이트 가능` : status === 'installed' ? '설치됨' : status === 'older' ? `설치된 v${installedVersion}보다 낮음` : '설치 가능'} · 키 {entry.publisherKeyFingerprint.slice(0, 12)}…</span>{entry.description && <small>{entry.description}</small>}</div><button disabled={status === 'installed' || status === 'older' || status === 'revoked' || Boolean(catalogBusy)} onClick={() => void downloadCatalogPack(entry)}>{catalogBusy === `${entry.packId}@${entry.version}` ? '검증 중…' : status === 'revoked' ? '회수됨' : status === 'update' ? '업데이트 검증' : status === 'available' ? '다운로드 검증' : status === 'installed' ? '설치됨' : '낮은 버전'}</button></article>)}
    </section>
    <section className="pack-import"><h3>Pack 설치</h3><input ref={inputRef} hidden type="file" accept=".json,.editweave-pack.json,application/json" onChange={(event) => { void read(event.target.files?.[0]); event.target.value = '' }} /><button className="pack-pick" onClick={() => inputRef.current?.click()}><Upload size={14} /> Creator Pack 선택</button>
      {pending && <article><PackageCheck size={20} /><div><strong>{pending.name} <small>v{pending.version}</small></strong><p>{pending.publisher} · API {pending.compatibility.minimumApiVersion}+ · {trustLabel}</p><span>{decisionLabel} · 모션 {counts?.[0]} · 속도 {counts?.[1]} · 오디오 {counts?.[2]} · 타이틀 {counts?.[3]} · 전환 {counts?.[4]} · 출력 {counts?.[5]}</span>{pending.verification?.keyFingerprint && <small>키 지문 {pending.verification.keyFingerprint.slice(0, 16)}…</small>}</div>
        <div className="pack-actions">{trust?.status === 'untrusted' && <button disabled={installBlocked} onClick={() => install(true)}>{installBlocked ? '안전 정책으로 차단' : '제작자 신뢰 후 설치'}</button>}
          {trust?.status !== 'untrusted' && <button disabled={installBlocked} onClick={() => install(false)}>{installBlocked ? '안전 정책으로 차단' : decision?.status === 'upgrade' ? '안전 업데이트' : '검토한 설정 설치'}</button>}
          {pending.verification?.signature === 'verified' && trust?.status !== 'blocked' && <button className="danger" onClick={blockPublisher}><Ban size={13} /> 키 차단</button>}
          {trust?.status === 'blocked' && <button onClick={trustPublisherAgain}>차단 해제 후 다시 신뢰</button>}</div>
      </article>}
      {error && <p className="pack-error">{error}</p>}
    </section>
    {installed.length > 0 && <section className="pack-import"><h3>설치된 Pack</h3>{installed.map((pack) => <article key={pack.id}><PackageCheck size={18} /><div><strong>{pack.name} <small>v{pack.version}</small></strong><p>{pack.publisher} · {pack.verification.signature === 'verified' ? '제작자 서명·키 지문 고정' : pack.verification.integrity === 'verified' ? '무결성 확인' : '레거시'}</p></div><button className="danger" onClick={() => uninstall(pack.id)}>안전 제거</button></article>)}</section>}
    <footer>동일한 내용은 중복 설치하지 않으며, 제거 시 사용자가 수정한 템플릿은 보존합니다.</footer>
  </section></div>
}
