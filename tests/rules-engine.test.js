const {test}=require('node:test');
const assert=require('node:assert/strict');
const R=require('../rules-engine');
const unit=(id,x,y,extra={})=>({id,x,y,w:60,h:40,angle:0,owner:'p1',pace:8,mobility:2,melee:4,shoot:3,range:24,defence:5,...extra});
const tile=(x,y,type)=>({x,y,w:70,h:70,terrain:true,type});
const activation=()=>({distance:0,pivots:0,action:'Move'});
const ctx=(units,terrain=[],extra={})=>({units,terrain,master:'p1',activation:activation(),...extra});

test('move uses pace, backward half pace, cumulative distance and one direction',()=>{
    const u=unit('a',100,500), c=ctx([u]);
    assert.equal(R.move(u,8,false,c).unit.y,340);
    assert.throws(()=>R.move(u,4.1,true,c),/left/);
    c.activation.distance=6;
    assert.throws(()=>R.move(u,3,false,c),/left/);
    c.activation.direction='forwards';
    assert.throws(()=>R.move(u,1,true,c),/direction/);
});
test('continuous collision detects obstructions between endpoints and rotated board edges',()=>{
    const u=unit('a',100,500), ally=unit('b',100,400);
    assert.throws(()=>R.move(u,8,false,ctx([u,ally])),/path/);
    assert.throws(()=>R.move(u,8,false,ctx([u],[tile(100,400,'swamp')])),/path/);
    assert.throws(()=>R.move(unit('a',1,40,{angle:45}),4,false,ctx([])),/battlefield/);
});
test('forward charge stops at first enemy, while backwards and mid-move pivots cannot charge',()=>{
    const u=unit('a',100,500), enemy=unit('b',100,400,{owner:'p2'}), c=ctx([u,enemy]);
    const result=R.move(u,8,false,c);
    assert.equal(result.unit.y,440);assert.equal(result.charged,true);assert.equal(result.distance,3);
    c.activation.movePivoted=true;
    assert.throws(()=>R.move(u,8,false,c),/path/);
    const back=unit('c',100,580,{owner:'p2'});
    assert.throws(()=>R.move(u,4,true,ctx([u,back])),/path/);
});
test('only Master Tactician disengages; no movement through contacting enemy',()=>{
    const u=unit('a',100,440), enemy=unit('b',100,400,{owner:'p2'});
    assert.throws(()=>R.move(u,1,true,ctx([u,enemy],[],{master:'p2'})),/Master/);
    assert.equal(R.move(u,1,true,ctx([u,enemy])).unit.y,460);
});
test('slowing applies to entire move including crossing and starting in terrain; defence <=4 ignores it',()=>{
    const u=unit('a',100,500), field=tile(100,450,'field');
    assert.throws(()=>R.move(u,6,false,ctx([u],[field])),/Slowing/);
    assert.equal(R.move({...u,defence:4},6,false,ctx([u],[field])).distance,6);
    const c=ctx([u],[field]);c.activation.distance=4.5;
    assert.throws(()=>R.move(u,1,false,c),/Slowing/);
});
test('pivots enforce mobility, maximum angle, contact, swept collisions and extra pivot',()=>{
    const u=unit('a',100,500,{mobility:0}), c=ctx([u]);
    assert.throws(()=>R.pivot(u,45,c),/No pivots/);
    c.activation.action='Extra Pivot';assert.equal(R.pivot(u,90,c).angle,90);
    assert.throws(()=>R.pivot(u,91,c),/90/);
    const enemy=unit('b',100,460,{owner:'p2'});
    assert.throws(()=>R.pivot(u,45,ctx([u,enemy])),/contact/);
    const blocker=unit('b',161,500,{w:10,h:10});
    assert.throws(()=>R.pivot({...u,mobility:2},90,ctx([u,blocker])),/clearance/);
});
test('shooting requires range, whole card in front, no contact and full visibility',()=>{
    const u=unit('a',200,500), v=unit('b',200,200,{owner:'p2'});
    assert.equal(R.shotReason(u,v,[u,v],[]),'');
    assert.match(R.shotReason({...u,range:3},v,[u,v],[]),/range/);
    assert.match(R.shotReason(u,{...v,y:580},[u,v],[]),/front/);
    assert.match(R.shotReason(u,v,[u,v,unit('c',200,350)],[]),/visible/);
    assert.match(R.shotReason(u,v,[u,v],[tile(200,350,'forest')]),/visible/);
    assert.match(R.shotReason(u,v,[u,v,unit('c',200,240)],[]),/contact/);
});
test('height sees over units, but not concealing terrain; outside hills block sight',()=>{
    const u=unit('a',200,500), v=unit('b',200,200,{owner:'p2'}), blocker=unit('c',200,350);
    assert.equal(R.shotReason(u,v,[u,v,blocker],[tile(190,490,'hills')]),'');
    assert.match(R.shotReason(u,v,[u,v],[tile(200,350,'hills')]),/visible/);
    assert.match(R.shotReason(u,v,[u,v],[tile(190,490,'hills'),tile(200,350,'forest')]),/visible/);
});
test('armour piercing, evasion, minimum dice and critical hits resolve with one bonus generation',()=>{
    const u=unit('a',200,500,{shoot:2,shootAP:true}), v=unit('b',200,200,{owner:'p2'});
    let result=R.attack(u,v,'Shoot',ctx([u,v]),()=>.999);
    assert.equal(result.target,3);assert.equal(result.critical.length,2);assert.equal(result.strain,4);
    result=R.attack(u,{...v,mobility:3},'Shoot',ctx([u,v]),()=>.5);
    assert.equal(result.target,6);assert.equal(result.strain,0);
    result=R.attack({...u,shoot:1},v,'Shoot',ctx([u,v],[tile(190,190,'hills')]),()=>0);
    assert.equal(result.pool,1);
});
test('flanking excludes the front, includes sides and is cancelled by another army contact',()=>{
    const u=unit('a',200,400), front=unit('b',200,360,{owner:'p2'}), flank=unit('c',260,400,{owner:'p2'});
    assert.equal(R.outflanked(u,[u,front]),false);
    assert.equal(R.outflanked(u,[u,flank]),true);
    assert.equal(R.outflanked(u,[u,flank,unit('d',320,400)]),false);
});
test('free charge strike uses pre-move height',()=>{
    const u=unit('a',200,400), v=unit('b',200,360,{owner:'p2',angle:180});
    const result=R.attack(u,v,'Strike',{...ctx([u,v]),chargeHeight:true},()=>0);
    assert.equal(result.height,1);assert.equal(result.pool,5);
});
