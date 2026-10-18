const { createAccessModule } = require("../../utils/meetingGateway/access");
const { authorizedRetrieval } = require("../../utils/chats/authorizedRetrieval");
describe("meeting retrieval admission", () => {
 const owner={kind:"USER",userId:41}; const activeBridge={allowed:true,userId:41,bridgeId:"bridge-1",expiresAt:2000};
 function makeAccess({policy={workspace_id:8,owner_user_id:41,state:"ACTIVE",policy_epoch:3},imports=[],now=1000,importLookup=jest.fn(async()=>imports)}={}){
  const store={policyByWorkspace:jest.fn(async()=>policy),getWorkspaceImports:importLookup};
  const sessions={isBridgeCurrent:jest.fn(async({actor,bridge})=>bridge.bridgeId==="bridge-1" && Number(actor.userId)===41)};
  return {access:createAccessModule({store,sessions,clock:()=>now}),store,importLookup};
 }
 test("A-SEC-001-01 allows an owner with a live bridge only while every managed import is VALID",async()=>{
  const {access,importLookup}=makeAccess({imports:[{id:"i1",access_state:"VALID"}]});
  const admission=await access.admit({actor:owner,workspaceId:8,bridge:activeBridge});
  expect(admission).toMatchObject({allowed:true,restricted:true,ownerUserId:41,policyEpoch:3}); expect(importLookup).toHaveBeenCalledWith(8);
 });
 test.each([
  ["A-SEC-001-02 rejects another actor",{actor:{kind:"USER",userId:42},bridge:{...activeBridge,userId:42}}],
  ["A-SEC-001-02 rejects a missing bridge",{actor:owner,bridge:null}],
  ["A-SEC-002-01 rejects an expired bridge",{actor:owner,bridge:{...activeBridge,expiresAt:1000}}],
 ])("%s before any retrieval work",async(_name,input)=>{
  const {access,importLookup}=makeAccess(); const admission=await access.admit({actor:input.actor,workspaceId:8,bridge:input.bridge});
  expect(admission.allowed).toBe(false); expect(importLookup).not.toHaveBeenCalled();
 });
 test("A-SEC-002-01 rejects unknown or revoked managed import state",async()=>{
  for(const access_state of ["UNVERIFIED","AUTH_REQUIRED","SOURCE_REVOKED",null]){
   const {access}=makeAccess({imports:[{id:"i1",access_state}]});
   expect(await access.admit({actor:owner,workspaceId:8,bridge:activeBridge})).toMatchObject({allowed:false,code:"MGW_ACCESS_STATE_INVALID"});
  }
 });
 test("A-SEC-002-02 fails closed when managed-import state cannot be read",async()=>{
  const {access}=makeAccess({importLookup:jest.fn(async()=>{throw new Error("db unavailable");})});
  expect(await access.admit({actor:owner,workspaceId:8,bridge:activeBridge})).toMatchObject({allowed:false,code:"MGW_ACCESS_STATE_UNAVAILABLE"});
 });
 test("A-WORKSPACE-001-01 leaves ordinary workspaces on the unrestricted path",async()=>{
  const {access,importLookup}=makeAccess({policy:null});
  expect(await access.admit({actor:null,workspaceId:9,bridge:null})).toMatchObject({allowed:true,restricted:false});
  expect(importLookup).not.toHaveBeenCalled();
 });
 test("A-REV-002-01 revalidates an admission before model generation",async()=>{
  let currentImports=[{id:"i1",access_state:"VALID"}]; const {access}=makeAccess({importLookup:jest.fn(async()=>currentImports)});
  const admission=await access.admit({actor:owner,workspaceId:8,bridge:activeBridge}); currentImports=[{id:"i1",access_state:"SOURCE_REVOKED"}];
  await expect(access.assertStillValid(admission)).rejects.toThrow("MGW_ACCESS_STATE_INVALID");
 });
});
describe("authorized retrieval wrapper",()=>{
 test("A-SEC-001-01 denied admission never loads pins, parsed text, history, search, or calls the model",async()=>{
  const loadPinned=jest.fn(),loadParsed=jest.fn(),loadHistory=jest.fn(),search=jest.fn(),generate=jest.fn();
  await expect(authorizedRetrieval({admission:{allowed:false,code:"MGW_BUSINESS_AUTH_REQUIRED"},loadPinned,loadParsed,loadHistory,search,generate})).rejects.toThrow("MGW_BUSINESS_AUTH_REQUIRED");
  for(const dependency of [loadPinned,loadParsed,loadHistory,search,generate]) expect(dependency).not.toHaveBeenCalled();
 });
 test("A-REV-002-02 returns one authorized context bundle and checks revocation before generation",async()=>{
  const order=[]; const result=await authorizedRetrieval({
   admission:{allowed:true,restricted:true},assertStillValid:jest.fn(async()=>{order.push("admit");}),
   loadPinned:jest.fn(async()=>{order.push("pinned");return ["pin"];}),loadParsed:jest.fn(async()=>{order.push("parsed");return ["text"]}),
   loadHistory:jest.fn(async()=>{order.push("history");return ["turn"]}),search:jest.fn(async()=>{order.push("search");return ["hit"]}),
   generate:jest.fn(async({context})=>{order.push("generate");return context;})
  });
  expect(order).toEqual(["admit","pinned","parsed","history","search","admit","generate"]);
  expect(result).toEqual({pinned:["pin"],parsed:["text"],history:["turn"],results:["hit"]});
 });
});