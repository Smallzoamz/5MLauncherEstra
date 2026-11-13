import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { executeRealLaunch } from '../src/server/fivemBackend.js';
import { getSystemPresence } from '../src/server/systemPresence.js';

test('presence identifies FiveM bootstrap/build processes and excludes this launcher', async () => {
  for (const name of ['FiveM.exe','FiveM_b3095_GTAProcess.exe','FiveM_GTAProcess.exe','FiveM_ROSLauncher.exe']) {
    const result=await getSystemPresence(async()=>[name,'STEAM.EXE']);
    assert.equal(result.fivem?.running,true,name);
    assert.equal(result.steam.running,true);
  }
  assert.equal((await getSystemPresence(async()=>['FiveM Launcher.exe','Estra FiveM Launcher.exe','chrome.exe'])).fivem?.running,false);
  assert.equal((await getSystemPresence(async()=>{throw new Error('tasklist unavailable')})).fivem?.running,null);
});

test('launch blocks active FiveM and unavailable detection; CL2 explicitly bypasses both', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'launcher-process-test-'));
  t.after(async()=>{assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('launcher-process-test-'));await fs.rm(root,{recursive:true,force:true});});
  await fs.writeFile(path.join(root,'FiveM.exe'),'fixture - never execute');
  let spawns=0, lastArgs;
  const launchThroughExplorer=async(installation,args)=>{spawns++;lastArgs=args;};
  const server={ip:'example.com:30120',fivemPath:root,cl2:false};
  const deps={platform:'win32',launchThroughExplorer,getProcessNames:async()=>['FiveM_b3095_GTAProcess.exe'],queryLiveServer:async()=>({online:true,gameBuild:'3095',lockPure:0,requirementsSource:'Direct HTTP'})};
  await assert.rejects(executeRealLaunch(server,deps),e=>e.status===409 && /FiveM/.test(e.message));
  assert.equal(spawns,0);
  const unknown={...deps,getProcessNames:async()=>{throw new Error('tasklist unavailable')}};
  await assert.rejects(executeRealLaunch(server,unknown),e=>e.status===503);
  assert.equal(spawns,0);
  assert.equal((await executeRealLaunch({...server,cl2:true},deps)).success,true);
  assert.deepEqual(lastArgs,['-cl2','-b3095','-pure_0','fivem://connect/example.com:30120']);
  assert.equal((await executeRealLaunch({...server,cl2:true},unknown)).success,true);
  assert.equal((await executeRealLaunch(server,{...deps,getProcessNames:async()=>['FiveM Launcher.exe']})).success,true);
  assert.equal(spawns,3);
});
