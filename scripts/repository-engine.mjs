// Private desktop subprocess protocol. Never expose a listening socket or write
// credentials/findings to disk. The parent owns the only stdin/stdout handles.
import {createInterface} from 'node:readline';
import {scanFullRepository} from '../dist/repository-full.js';
import {demoReport,parseRepository} from '../dist/repository-scanner.js';

const input=createInterface({input:process.stdin,crlfDelay:Infinity});
const abort=new AbortController();
let started=false,finished=false;
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
// A native stream failure must produce a safe terminal outcome, never expose
// raw stack traces/repository content or leave the parent with only exit 1.
let failing=false;
const fatal=error=>{
 if(failing)return;failing=true;finished=true;abort.abort();
 const allowed=['EPIPE','ECONNRESET','ENOENT','ENOMEM','EACCES','EPERM'];
 const code=allowed.includes(error?.code)?'ENGINE_'+error.code:'ENGINE_FAILURE';
 const outcome={type:'error',code,error:'The local scanner was interrupted. No complete report was produced. Retry the check; if it repeats, share this diagnostic code with support.'};
 process.stdout.write(JSON.stringify(outcome)+'\n',()=>process.exit(1));
 setTimeout(()=>process.exit(1),500).unref();
};
process.on('uncaughtException',fatal);
process.on('unhandledRejection',fatal);
process.stdout.on('error',()=>process.exit(1));
process.stdin.on('error',fatal);
input.on('close',()=>{if(!finished)abort.abort();});
input.on('line',line=>{
 if(line.length>32_768){abort.abort();return;}
 let message;try{message=JSON.parse(line);}catch{return;}
 if(message.type==='cancel'){abort.abort();return;}
 if(started||message.type!=='scan')return;
 started=true;
 void (async()=>{
  try{
   if(message.demo===true){send({type:'result',report:demoReport(true)});return;}
   parseRepository(message.url);
   if(typeof message.accessToken!=='string'||message.accessToken.length>16_384||!message.accessToken){throw new Error('PRO_REQUIRED');}
   send({type:'progress',progress:{stage:'Checking Pro access',checked:0,findings:0}});
   const response=await fetch('https://promptshield-beta.vercel.app/api/account',{
    headers:{Authorization:'Bearer '+message.accessToken},redirect:'error',
    signal:AbortSignal.any([abort.signal,AbortSignal.timeout(20_000)])
   });
   message.accessToken='';
   if(!response.ok)throw new Error('PRO_REQUIRED');
   const account=await response.json();
   if(account.active!==true||account.repositoryAccess!==true)throw new Error('PRO_REQUIRED');
   const report=await scanFullRepository(message.url,abort.signal,true,progress=>send({type:'progress',progress}),message.includeHistory===true);
   if(abort.signal.aborted)throw new Error('CANCELLED');
   send({type:'result',report});
  }catch(error){
   const code=abort.signal.aborted?'CANCELLED':error?.message==='PRO_REQUIRED'?'PRO_REQUIRED':'SCAN_FAILED';
   send({type:'error',code,error:code==='PRO_REQUIRED'?'Sign in to an active Pro account to check repositories.':code==='CANCELLED'?'Repository check cancelled.':'Repository could not be checked. Check the public GitHub URL and your connection, then try again.'});
  }finally{
   finished=true;input.close();process.stdin.destroy();
  }
 })();
});
