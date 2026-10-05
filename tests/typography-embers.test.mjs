import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmberTrail } from '../components/burn/type/embers.js';
const frame = (trail, now, touching=true, x=100) => trail.update({x,y:100,touching,radius:40,now,dt:0.05});
test('warming precedes ignition and grows to full fire',()=>{
 const trail=createEmberTrail();
 frame(trail,50); frame(trail,100);
 assert.ok(trail.sites[0].energy<0.25, 'quick entry must not immediately produce flames');
 for(let t=150;t<=800;t+=50)frame(trail,t);
 assert.equal(trail.sites[0].energy,1);
});
test('leaving preserves a visible tail and eventually extinguishes',()=>{
 const trail=createEmberTrail();for(let t=50;t<=800;t+=50)frame(trail,t);
 frame(trail,1000,false);assert.equal(trail.sites[0].energy,1);
 frame(trail,1500,false);assert.ok(trail.sites[0].energy>0.7);
 frame(trail,2300,false);assert.ok(trail.sites[0].energy>0 && trail.sites[0].energy<0.3);
 frame(trail,2850,false);assert.equal(trail.sites[0].energy,0);
});
test('moving between letters leaves fire at its old root; new letters start cold',()=>{
 const trail=createEmberTrail();for(let t=50;t<=800;t+=50)frame(trail,t);
 frame(trail,850,true,160);
 assert.equal(trail.sites[0].x,100);assert.equal(trail.sites[0].energy,1);
 assert.equal(trail.sites[1].x,160);assert.ok(trail.sites[1].energy<0.1);
});
