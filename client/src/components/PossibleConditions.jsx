export default function PossibleConditions({ items = [], heading = 'Possible conditions to discuss' }) {
  return <section className="possible-conditions" aria-label={heading}>
    <div className="section-heading"><div><p className="eyebrow">A STARTING POINT FOR YOUR PHYSICIAN</p><h3>{heading}</h3></div><span className="status-pill">Not a confirmed diagnosis</span></div>
    <p className="hint">These are AI-generated possibilities, not a final medical opinion. A physician should assess your symptoms, history and any further tests.</p>
    {!items.length && <p className="condition-empty">No specific condition suggestions were returned. This does not rule out illness or replace a check-up.</p>}
    <div className="condition-grid">{items.map((item,i)=><article className="condition-card" key={i}><span className="condition-number">0{i+1} · POSSIBLE</span><h4>{item.condition}</h4><p>{item.rationale}</p>{item.supportingTests?.length>0&&<div className="evidence-tags">{item.supportingTests.map(name=><span key={name}>{name}</span>)}</div>}{item.uncertainty&&<p className="condition-note"><strong>What remains uncertain</strong>{item.uncertainty}</p>}{item.followUp&&<p className="condition-note"><strong>Discuss with your physician</strong>{item.followUp}</p>}</article>)}</div>
  </section>;
}
