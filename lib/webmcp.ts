type Registry = { registerTool: (tool: {name:string;description:string;inputSchema:object;annotations:object;execute:(input:unknown)=>unknown}, options:{signal:AbortSignal}) => void | Promise<void> };
export function registerRaceTools(start:()=>void,read:()=>{status:string}) {
  const context=(document as Document & {modelContext?:Registry}).modelContext;
  if(!context?.registerTool)return ()=>{};
  const lifecycle=new AbortController();
  const tool={name:'start_race',description:'Start a new race using the track and lap count selected in the game menu. Starts the three-second countdown.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input:unknown){if(typeof input!=='object'||input===null||Array.isArray(input)||Object.keys(input).length)throw new Error('Expected an empty object.');if(!['ready','finished'].includes(read().status))throw new Error('A race is already in progress.');start();return read();}};
  try{Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{/* Optional API; the game works without it. */}
  return ()=>lifecycle.abort();
}
