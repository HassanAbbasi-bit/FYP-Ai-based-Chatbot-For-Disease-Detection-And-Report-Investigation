import {useEffect,useRef,useState} from 'react';
import {api} from '../api/client';
export default function Feedback({kind,targetId,onExpired}){
 const [open,setOpen]=useState(false),[helpful,setHelpful]=useState('yes'),[unsupported,setUnsupported]=useState(false),[comment,setComment]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const controller=useRef(null),callback=useRef(onExpired);
 useEffect(()=>{callback.current=onExpired;},[onExpired]);useEffect(()=>()=>controller.current?.abort(),[]);
 async function save(e){e.preventDefault();const c=new AbortController();controller.current=c;setBusy(true);setNotice('');try{await api('/feedback',{method:'PUT',body:{kind,targetId,helpful:helpful==='yes',unsupported,comment:comment||null},signal:c.signal});if(!c.signal.aborted)setNotice('Feedback saved.');}catch(err){if(!c.signal.aborted){if(err.status===401)callback.current?.();else setNotice(err.message);}}finally{if(!c.signal.aborted)setBusy(false);}}
 return <div className="feedback"><button className="secondary" aria-expanded={open} onClick={()=>setOpen(!open)}>Feedback on this response</button>{open&&<form onSubmit={save}><label>Was this response helpful?<select value={helpful} onChange={e=>setHelpful(e.target.value)}><option value="yes">Helpful</option><option value="no">Not helpful</option></select></label><label><input type="checkbox" checked={unsupported} onChange={e=>setUnsupported(e.target.checked)}/>Report incorrect or unsupported content</label><label>Optional comment (avoid copying sensitive details)<textarea maxLength={500} value={comment} onChange={e=>setComment(e.target.value)}/></label><button disabled={busy}>Save feedback</button><p role="status">{notice}</p></form>}</div>;
}
