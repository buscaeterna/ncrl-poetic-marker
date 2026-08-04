import type { ImportedCorpus, ImportedPoem } from "./corpus";
import type { CorpusWorkspace } from "./corpus-db";

export type RevisionedProject = {id:string;name:string;schema_version:number;revision:number;workspace?:CorpusWorkspace};
type FetchLike=(input:string,init?:RequestInit)=>Promise<Response>;

export function mergePdfImport(workspace:CorpusWorkspace, additions:{corpora:ImportedCorpus[];poems:ImportedPoem[]}, sourceDocumentId:string):CorpusWorkspace {
  if(workspace.poems.some(poem=>poem.provenance?.sourceDocumentId===sourceDocumentId)) return workspace;
  const poemIds=additions.poems.map(poem=>poem.id);
  return {corpora:[...workspace.corpora,...additions.corpora],poems:[...workspace.poems,...additions.poems],activeId:poemIds[0]??workspace.activeId,queue:[...workspace.queue,...poemIds]};
}
async function decode<T>(response:Response):Promise<T>{if(!response.ok)throw new Error(`Project API failed (${response.status})`);return response.json() as Promise<T>}
export async function persistPdfProjectImport(args:{project:RevisionedProject;baseWorkspace:CorpusWorkspace;corpora:ImportedCorpus[];poems:ImportedPoem[];sourceDocumentId:string;fetcher?:FetchLike}) {
  const fetcher=args.fetcher??fetch;
  const put=async(project:RevisionedProject,workspace:CorpusWorkspace)=>fetcher(`/api/v1/projects/${project.id}`,{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({name:project.name,schema_version:project.schema_version,revision:project.revision,workspace})});
  let workspace=mergePdfImport(args.baseWorkspace,{corpora:args.corpora,poems:args.poems},args.sourceDocumentId);
  let response=await put(args.project,workspace);
  const completed=(project:RevisionedProject,fallback:CorpusWorkspace,alreadyImported:boolean)=>{
    const actualWorkspace=project.workspace??fallback;
    const savedPoems=actualWorkspace.poems.filter(poem=>poem.provenance?.sourceDocumentId===args.sourceDocumentId);
    if(!savedPoems.length)throw new Error("Saved PDF poems are missing from the server workspace");
    return {project,workspace:actualWorkspace,alreadyImported,activePoemId:savedPoems[0].id,savedPoems};
  };
  if(response.status!==409){const saved=await decode<RevisionedProject>(response);return completed(saved,workspace,false)}
  const fresh=await decode<RevisionedProject>(await fetcher(`/api/v1/projects/${args.project.id}`));
  const freshWorkspace=fresh.workspace!;
  const alreadyImported=freshWorkspace.poems.some(poem=>poem.provenance?.sourceDocumentId===args.sourceDocumentId);
  if(alreadyImported)return completed(fresh,freshWorkspace,true);
  workspace=mergePdfImport(freshWorkspace,{corpora:args.corpora,poems:args.poems},args.sourceDocumentId);
  response=await put(fresh,workspace);
  return completed(await decode<RevisionedProject>(response),workspace,false);
}
