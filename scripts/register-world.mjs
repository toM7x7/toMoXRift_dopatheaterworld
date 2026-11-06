import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { getAuthenticatedClient } from '../../../node_modules/@xrift/cli/dist/lib/api.js'

async function main(){
const metadataUrl=new URL('../.xrift/world.json',import.meta.url)
let existing
try{existing=JSON.parse(await readFile(metadataUrl,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
if(existing){console.log(JSON.stringify({reused:true,id:existing.id}));process.exit(0)}
const client=await getAuthenticatedClient()
const {data}=await client.post('/api/public/v1/worlds',{})
if(typeof data.id!=='string')throw new Error('World creation returned no id')
await mkdir(new URL('../.xrift/',import.meta.url),{recursive:true})
await writeFile(metadataUrl,JSON.stringify({id:data.id,createdAt:new Date().toISOString(),lastUploadedAt:null},null,2))
await mkdir(new URL('../docs/',import.meta.url),{recursive:true})
await writeFile(new URL('../docs/creation-record.json',import.meta.url),JSON.stringify({id:data.id,status:data.status,isPublic:data.isPublic,responseKeys:Object.keys(data)},null,2))
console.log(JSON.stringify({created:true,id:data.id,status:data.status,isPublic:data.isPublic,responseKeys:Object.keys(data)}))
}
main().catch(error=>{console.error(`World registration failed (HTTP ${error.response?.status??'unavailable'}). Details omitted to protect credentials.`);process.exitCode=1})
