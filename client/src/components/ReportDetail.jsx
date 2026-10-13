import { formatSize } from "../api/reports";
import ReportPreview from "./ReportPreview";
import ExtractionReview from "./ExtractionReview";
import ReportResults from './ReportResults';
import { useState } from 'react';
export default function ReportDetail({ report, onExpired, onDelete, busy, onDirtyChange, onOpenChat }) {
  const [stage,setStage]=useState('review'), [dirty,setDirty]=useState(false);
  const stages=[['original','01','Original document'],['review','02','Review extracted values'],['analysis','03','AI interpretation']];
  return <section className="report-detail" aria-labelledby="report-detail-title">
    <div className="report-document-heading"><div><p className="eyebrow">REPORT WORKSPACE</p><h2 id="report-detail-title">{report.displayName}</h2><p className="hint">{report.fileType || "Type awaiting validation"} · {formatSize(report.size)} · {new Date(report.createdAt).toLocaleDateString()}</p></div><button className="secondary" disabled={busy} onClick={onDelete}>Delete report</button></div>
    <div className="report-stage-nav" role="tablist" aria-label="Report workflow">{stages.map(([id,n,label],index)=><button key={id} role="tab" id={`tab-${id}`} tabIndex={stage===id?0:-1} aria-selected={stage===id} aria-controls={`panel-${id}`} onClick={()=>setStage(id)} onKeyDown={e=>{let next;if(e.key==='ArrowRight')next=(index+1)%3;else if(e.key==='ArrowLeft')next=(index+2)%3;else if(e.key==='Home')next=0;else if(e.key==='End')next=2;if(next!==undefined){e.preventDefault();setStage(stages[next][0]);e.currentTarget.parentElement.children[next].focus();}}}><span>{n}</span>{label}</button>)}</div>
    <div className="report-detail-body"><div id="panel-original" role="tabpanel" aria-labelledby="tab-original" hidden={stage!=='original'} className="report-original" aria-label="Original report">
    {report.status === "uploaded" ? <>
      <p className="demo-banner">Uploaded — extract the entries, check them, and mark the report reviewed before interpretation.</p>
      {report.fileType === "application/pdf" ? <p>PDF preview is not embedded. Download the private original to open it in your own viewer. Treat downloaded documents as untrusted.</p> : <ReportPreview key={report.id} report={report} onExpired={onExpired} />}
      <a className="button-link secondary" href={`/api/reports/${report.id}/file?download=1`} download>Download original</a>
    </> : <p role="status">{report.status === "deleting" ? "Deletion is incomplete. Retry Delete to finish removing the file." : "Upload is incomplete. Refresh after cleanup, then retry the selected file."}</p>}
    </div>
    <div id="panel-review" role="tabpanel" aria-labelledby="tab-review" hidden={stage!=='review'}>{report.status === "uploaded" && <ExtractionReview key={report.id} report={report} onExpired={onExpired} onDirtyChange={value=>{setDirty(value);onDirtyChange?.(value);}} onReviewed={()=>setStage('analysis')} />}</div>
    <div id="panel-analysis" role="tabpanel" aria-labelledby="tab-analysis" hidden={stage!=='analysis'}>{report.status==='uploaded'&&<ReportResults report={report} onExpired={onExpired} onOpenChat={onOpenChat} reviewDirty={dirty}/>}</div>
    </div>
  </section>;
}
