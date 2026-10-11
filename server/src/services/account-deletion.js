const {ReportError}=require('./report-errors');
function createAccountDeletion({connection,reports}){
 const User=connection.models.User;let closed=false,running=null;
 async function conversations(ownerId){await connection.transaction(async session=>{await require('./consent').accountFence(connection,ownerId,session);for(const name of ['Message','ChatRequest','Conversation'])if(connection.models[name])await connection.models[name].deleteMany({ownerId},{session});if(connection.models.Feedback)await connection.models.Feedback.deleteMany({ownerId,kind:'message'},{session});});}
 async function mark(ownerId,password){const user=await User.findById(ownerId).select('+passwordHash');if(!user||!await require('./password').verifyPassword(user.passwordHash,password))throw new ReportError(401,'REAUTHENTICATION_FAILED','Current password is incorrect.');await User.updateOne({_id:ownerId,deletionState:{$ne:'pending'}},{$set:{deletionState:'pending',deletionRequestedAt:new Date(),healthContext:{medications:null,allergies:null,conditions:null},consent:{noticeVersion:'fyp-ai-v1',chat:false,reports:false,profile:false,decidedAt:new Date()}},$inc:{contextFence:1,privacyVersion:1}});await sessions(ownerId);void tick();}
 async function sessions(ownerId){const id=String(ownerId);await connection.db.collection('sessions').deleteMany({$or:[{'session.userId':id},{session:{$regex:`"userId":"${id}"`}}]});}
 async function clean(ownerId){
  const rows=await reports.Report.find({ownerId}).limit(1000).select('_id').lean();
  for(const r of rows)await reports.remove({_id:r._id,ownerId});
  await reports.cleanup();if(await reports.Report.exists({ownerId}))return;
  await connection.transaction(async session=>{const pending=await User.findOne({_id:ownerId,deletionState:'pending'}).session(session);if(!pending)return;for(const name of ['Message','ChatRequest','Conversation','ExtractionJob','ExtractionResult','ReportReview','Analysis','Feedback'])if(connection.models[name])await connection.models[name].deleteMany({ownerId},{session});await sessions(ownerId);await User.deleteOne({_id:ownerId,deletionState:'pending'},{session});});
 }
 async function tick(){if(closed)return;if(running)return running;running=(async()=>{try{for(const user of await User.find({deletionState:'pending'}).limit(20).select('_id').lean())try{await clean(user._id);}catch{/* Pending account remains blocked and retries after storage/database recovery. */}}catch{}finally{running=null;}})();return running;}
 const timer=setInterval(()=>void tick(),5000);timer.unref();void tick();
 return {mark,conversations,tick,close:async()=>{closed=true;clearInterval(timer);await running;}};
}
module.exports={createAccountDeletion};
