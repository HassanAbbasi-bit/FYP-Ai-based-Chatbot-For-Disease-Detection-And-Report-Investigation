import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
export default function ReportResults({ report, onExpired, onOpenChat }) {
 const [data,setData] = useState(null), [review,setReview] = useState(null), [error,setError] = useState(''), [busy,setBusy] = useState(false);
 const callbacks = useRef({onExpired,onOpenChat}), controllers = useRef(new Set()), alive = useRef(true), request = useRef(null);
 useEffect(()=>{callbacks.current={onExpired,onOpenChat};},[onExpired,onOpenChat]);
 const load = useCallback(async()=>{
  const c = new AbortController(); controllers.current.add(c);
  try { const [a,r] = await Promise.all([api(`/reports/${report.id}/analyses`,{signal:c.signal}),api(`/reports/${report.id}/extraction`,{signal:c.signal})]); if(alive.current&&!c.signal.aborted){setData(a);setReview(r.review);if(!a.analyses.some(j=>['queued','running'].includes(j.state)))request.current=null;} }
  catch(e){if(alive.current&&e.name!=='AbortError'){if(e.status===401)callbacks.current.onExpired();else setError(e.message);}}finally{controllers.current.delete(c);}
 },[report.id]);
 useEffect(()=>{alive.current=true;const active=controllers.current;const timer=setTimeout(load,0),poll=setInterval(load,3000);return()=>{alive.current=false;clearTimeout(timer);clearInterval(poll);active.forEach(c=>c.abort());active.clear();};},[load]);
 async function action(path,body){if(busy)return;setBusy(true);setError('');const c=new AbortController();controllers.current.add(c);try{await api(path,{method:'POST',body,signal:c.signal});if(alive.current&&!c.signal.aborted)await load();}catch(e){if(alive.current&&e.name!=='AbortError'){if(e.status===401)callbacks.current.onExpired();else setError(e.message);}}finally{controllers.current.delete(c);if(alive.current)setBusy(false);}}
 const pending=data?.analyses.find(j=>['queued','running'].includes(j.state));
 return <section className="report-results" aria-labelledby={`results-${report.id}`}><h2 id={`results-${report.id}`}>Report results and conversation</h2>
 <p className="demo-banner">{data?.available?'DEMO — dedicated synthetic sample. Results copy reviewed entries; no medical interpretation is performed.':'Real analysis and report questions need a confirmed corrected-data AI contract. No sample findings are attached to your upload.'}</p>
 <p>User-reviewed means checked by you, not clinically validated. Save and mark your entries reviewed first. Report processing consent is required in Settings.</p>
 {error&&<p className="error" role="alert">{error}</p>}
 <button className="secondary" onClick={load} disabled={busy}>Refresh saved revision and results</button>
 <button disabled={busy||Boolean(pending)||!data?.available||review?.status!=='reviewed'} onClick={()=>{request.current||={requestId:crypto.randomUUID(),reviewVersion:review.version};action(`/reports/${report.id}/analyses`,request.current);}}>Request synthetic result</button>
 {pending&&<><p role="status">{pending.state}</p><button className="secondary" disabled={busy} onClick={()=>action(`/reports/${report.id}/analyses/${pending.id}/cancel`,{})}>Cancel local attempt</button></>}
 {review?.status==='reviewed'&&<button className="secondary" disabled={busy} onClick={()=>callbacks.current.onOpenChat?.({reportId:report.id,reviewVersion:review.version})}>Open conversation for revision {review.version}</button>}
 <p className="hint">Report conversations stay separate from general chat. Ordinary report questions remain unavailable until the AI accepts reviewed context.</p>
 {data?.analyses.map(a=><article key={a.id}><h3>Revision {a.reviewVersion} · {a.state}</h3>{a.outdated&&<p className="error" role="status">Outdated — this result belongs to an earlier saved review.</p>}{a.errorCode&&<p role="status">Attempt failed: {a.errorCode}. Request a new attempt after resolving the cause.</p>}{a.output&&<><p className="demo-banner">DEMO · {new Date(a.generatedAt).toLocaleString()}</p><div className="table-scroll"><table><caption>Saved reviewed entries for revision {a.reviewVersion}</caption><thead><tr><th scope="col">Test</th><th scope="col">Value</th><th scope="col">Unit</th><th scope="col">Reported range</th><th scope="col">Range flag</th></tr></thead><tbody>{a.output.rows.map(r=><tr key={r.id}><th scope="row">{r.testName}</th><td>{r.unknown?'Unknown':r.rawValue??'Unknown'}{r.unreadable?' (unreadable)':''}</td><td>{r.units??'Unknown'}</td><td>{r.referenceRange??'Not reported'}</td><td>{r.flag??'Not available'}</td></tr>)}</tbody></table></div><p>{a.output.rows[0]?.explanation}</p>{a.output.escalation&&<p className="error">{a.output.escalation}</p>}<ul>{a.output.limitations.map((l,i)=><li key={i}>{l}</li>)}</ul><p>Sources: none supplied.</p></>}</article>)}
 </section>;
}
