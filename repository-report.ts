import type {RepoReport, RepoFinding} from './repository-scanner.js';

export type FindingOccurrence = {path:string;line:number;url?:string;location?:string;historical:boolean};
export type FindingGroup = RepoFinding & {id:string;occurrences:FindingOccurrence[];occurrenceCount:number;currentCount:number;historyCount:number;historyOnly:boolean};
export type RepositoryAssessment = {
  groups:FindingGroup[];
  summary:{rawMatches:number;uniqueFindings:number;actionable:number;reference:number;current:number;historyOnly:number;critical:number;high:number;medium:number;low:number;duplicatesCollapsed:number};
};

const isHistorical=(path:string)=>/\[(?:history |historical submodule |commit message |tag message )/.test(path);
const rank:Record<string,number>={critical:4,high:3,medium:2,low:1,info:0};

export function apiKeyCandidates(groups:FindingGroup[]):FindingGroup[] {
  return groups.filter(g=>g.disposition==='review'&&g.kind==='secret');
}

/** Merge by scanner-issued kind/value identity, never by the redaction marker.
 * Missing identities deliberately remain separate unless an explicit value exists.
 * Raw values and keyed fingerprints are excluded from text exports. */
export function aggregateRepositoryReport(report:RepoReport):RepositoryAssessment {
  const grouped=new Map<string,FindingGroup>();
  for(const [index,f] of report.findings.entries()) {
    const identity=f.fingerprint??(f.value!==undefined?`${f.kind??f.label}\0${f.value}`:`unidentified-${index}`);
    const occurrence:FindingOccurrence={path:f.path,line:f.line,historical:isHistorical(f.path),...(f.url?{url:f.url}:{}),...(f.location?{location:f.location}:{})};
    let group=grouped.get(identity);
    if(!group){group={...f,id:'finding-'+(grouped.size+1),occurrences:[],occurrenceCount:0,currentCount:0,historyCount:0,historyOnly:true};grouped.set(identity,group);}
    // A reference context must never dismiss the same value found as a genuine
    // candidate elsewhere. Prefer the highest priority representative, then HEAD.
    const promotes=f.disposition==='review'&&group.disposition==='reference';
    const sameDisposition=f.disposition===group.disposition;
    if(promotes||(sameDisposition&&(rank[f.severity]>rank[group.severity]||rank[f.severity]===rank[group.severity]&&!occurrence.historical&&isHistorical(group.path)))){
      Object.assign(group,f);
    }
    if(!group.occurrences.some(o=>o.path===occurrence.path&&o.line===occurrence.line&&o.location===occurrence.location))group.occurrences.push(occurrence);
    group.occurrenceCount++;
    if(occurrence.historical)group.historyCount++;else group.currentCount++;
    group.historyOnly=group.currentCount===0;
  }
  const groups=[...grouped.values()].sort((a,b)=>Number(a.disposition==='reference')-Number(b.disposition==='reference')||(rank[b.severity]??0)-(rank[a.severity]??0)||Number(a.historyOnly)-Number(b.historyOnly)||a.path.localeCompare(b.path)||a.line-b.line);
  const review=groups.filter(g=>g.disposition==='review');
  const count=(severity:string)=>review.filter(g=>g.severity===severity).length;
  return {groups,summary:{rawMatches:report.findings.length,uniqueFindings:groups.length,actionable:review.length,reference:groups.length-review.length,current:review.filter(g=>!g.historyOnly).length,historyOnly:review.filter(g=>g.historyOnly).length,critical:count('critical'),high:count('high'),medium:count('medium'),low:count('low'),duplicatesCollapsed:report.findings.length-groups.length}};
}

/** A shareable report is redacted regardless of the screen's Show/Hide state. */
export function reportToText(report:RepoReport):string {
  const {summary:s,groups}=aggregateRepositoryReport(report);
  const lines=[
    'REDAXA — REPOSITORY EXPOSURE REPORT',
    `Repository: ${report.repository}`,`Revision: ${report.commit}`,
    `Coverage: ${report.scanned}/${report.total} inventoried items checked; ${report.skipped} skipped. ${report.partial||!report.inventoryComplete?'PARTIAL — inspect coverage limitations.':'Inventory traversal completed within the stated scope.'}`,
    '',`${s.actionable} unique candidates need review: ${s.critical} critical-priority, ${s.high} high, ${s.medium} medium, ${s.low} low.`,
    `${s.current} present in the current snapshot; ${s.historyOnly} found only in history.`,
    `${s.rawMatches} raw matches; ${s.duplicatesCollapsed} repeated matches grouped; ${s.reference} unique informational/reference values.`,
    'Priority describes potential impact, not a confirmed vulnerability. No credential was tested against a provider.',
    'All matched values are redacted in this export. File paths may themselves be sensitive; review before sharing.',
    ''
  ];
  for(const g of groups){
    lines.push(`${g.disposition==='reference'?'INFORMATIONAL':g.severity.toUpperCase()+' PRIORITY'} — ${g.label} — ${g.historyOnly?'history only':'current snapshot'}`,`Value: [REDACTED]`,`Occurrences: ${g.occurrenceCount} (${g.currentCount} current, ${g.historyCount} historical)`,g.reason,g.action);
    for(const o of g.occurrences)lines.push(`  ${o.path}${o.location?' — '+o.location:':'+o.line}${o.historical?' [historical]':''}`);
    lines.push('');
  }
  lines.push('COVERAGE LIMITATIONS',...report.warnings);
  for(const f of report.coverage.filter(f=>f.status==='skipped'))lines.push(`${f.path}: ${f.reason}`);
  if(report.findingsTruncated)lines.push('Match display limit reached: counts describe returned matches only, not every possible match.');
  return lines.join('\n');
}
