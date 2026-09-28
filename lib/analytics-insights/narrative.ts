import { SchemaType, type GenerationConfig } from '@google/generative-ai';
import { categoryContent } from '@/lib/category-discovery/gemini-transport';
import { safeError } from '@/lib/category-discovery/diagnostics';
// A constrained verbalizer: Gemini may choose a plain-language wording, never numbers,
// conclusions, organization order or systemic classifications. All facts come from RPCs.
export function factSentences(hotspots: number, systemic: number, unassigned: number): [string[],string[]] {
  if (![hotspots,systemic,unassigned].every(v=>Number.isSafeInteger(v)&&v>=0)) throw Error('Invalid facts');
  return [[
    `За выбранный период выявлено ${hotspots} проблемных зон и ${systemic} системных проблем.`,
    `В данных за выбранный период — ${hotspots} проблемных зон и ${systemic} системных проблем.`,
  ],[
    `Без ответственной организации остаётся ${unassigned} обращений.`,
    `У ${unassigned} обращений сейчас нет ответственной организации.`,
  ]];
}
export function validateNarrative(value: unknown, choices: [string[],string[]]): string | null {
  const v=value as {sentences?:unknown}|null;
  if(!v || typeof v!=='object'||Object.keys(v).some(k=>k!=='sentences')||!Array.isArray(v.sentences)||v.sentences.length!==2)return null;
  const sentences=v.sentences;
  if(!choices.every((group,i)=>group.includes(sentences[i] as string)))return null;
  return sentences.join(' ');
}
export async function narrateFacts(choices: [string[],string[]]): Promise<string|null> {
  if(!process.env.GEMINI_API_KEY)return null;
  try {
    const config:GenerationConfig & {thinkingConfig:{thinkingBudget:number}}={temperature:0,maxOutputTokens:512,thinkingConfig:{thinkingBudget:0},responseMimeType:'application/json',responseSchema:{type:SchemaType.OBJECT,properties:{sentences:{type:SchemaType.ARRAY,items:{type:SchemaType.STRING}}},required:['sentences']}};
    const raw=await categoryContent([{text:`Выбери простую, естественную русскую формулировку готовых фактов: ровно одно предложение из каждой группы, в порядке групп. Скопируй выбранные предложения дословно. Нельзя считать, менять числа, дополнять факты, определять системность, сравнивать организации или прогнозировать. Ответ JSON {"sentences":[...]} . Группы: ${JSON.stringify(choices)}`}],config);
    const text=validateNarrative(JSON.parse(raw),choices);
    if(!text)console.warn('[analytics_insights]',{code:'UNSUPPORTED_OUTPUT'});
    return text;
  } catch(error){console.warn('[analytics_insights]',safeError(error));return null;}
}
