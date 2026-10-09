/** Read-only message snapshots. No send, close, read-receipt or attachment fetch operations. */
import {PILOTS,record,textField,type Unit} from './core.ts';
export type PilotMessage={id:string;text:string;sender:'guest'|'property'|'system';receivedAt:string;updatedAt:string;attachmentCount:number};
export type PilotThread={id:string;unit:Unit;title:string;provider:string;bookingId:string|null;closed:boolean;messageCount:number};
function id(value:unknown){const s=textField(value);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s))throw new Error('Invalid message resource ID');return s;}
function relation(row:Record<string,unknown>,name:string){const relationship=record(row.relationships)[name];if(relationship==null)return null;const data=record(relationship).data;return data==null?null:record(data).id;}
function timestamp(value:unknown){const s=textField(value);if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})?$/.test(s)||!Number.isFinite(Date.parse(s)))throw new Error('Invalid message timestamp');return s;}
export function normalizePilotThread(raw:unknown,unit:Unit):PilotThread{
 const row=record(raw),a=record(row.attributes);
 if(row.type!=='message_thread'||relation(row,'property')!==PILOTS[unit].propertyId)throw new Error('Thread outside pilot property');
 if(typeof a.is_closed!=='boolean'||!Number.isSafeInteger(a.message_count)||(a.message_count as number)<0)throw new Error('Invalid thread state');
 const booking=relation(row,'booking');
 return {id:id(row.id),unit,title:textField(a.title),provider:textField(a.provider),bookingId:booking==null?null:id(booking),closed:a.is_closed,messageCount:a.message_count as number};
}
export function normalizePilotMessage(raw:unknown,threadId:string):PilotMessage{
 const row=record(raw),a=record(row.attributes);
 if(row.type!=='message'||relation(row,'message_thread')!==id(threadId))throw new Error('Message outside selected thread');
 if(!['guest','property','system'].includes(String(a.sender))||!Array.isArray(a.attachments))throw new Error('Invalid message shape');
 if(a.message!=null&&typeof a.message!=='string')throw new Error('Invalid message text');
 return {id:id(row.id),text:a.message==null?'':a.message as string,sender:a.sender as PilotMessage['sender'],receivedAt:timestamp(a.inserted_at),updatedAt:timestamp(a.updated_at),attachmentCount:a.attachments.length};
}
