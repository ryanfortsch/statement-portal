/**
 * CRM module types + helpers.
 *
 * Two row shapes mirror the contacts + contact_touches tables 1:1.
 * Same channel vocabulary as properties.owner_last_contacted_via from
 * #155 so a touch logged here uses the same words as a touch logged on
 * the property page.
 */

export type ContactType = 'owner' | 'vendor' | 'lead' | 'other';
export type TouchChannel = 'email' | 'phone' | 'sms' | 'in_person' | 'other';

export const CONTACT_TYPE_LABELS: Record<ContactType, string> = {
  owner: 'Owner',
  vendor: 'Vendor',
  lead: 'Lead',
  other: 'Other',
};

export const TOUCH_CHANNEL_LABELS: Record<TouchChannel, string> = {
  email: 'Email',
  phone: 'Phone',
  sms: 'Text',
  in_person: 'In person',
  other: 'Other',
};

export type ContactRow = {
  id: string;
  type: ContactType;
  name: string;
  emails: string[];
  phone: string | null;
  organization: string | null;
  notes: string | null;
  tags: string[] | null;
  linked_property_ids: string[] | null;
  created_by_email: string;
  created_at: string;
  updated_at: string;
};

export type ContactTouchRow = {
  id: string;
  contact_id: string;
  touched_at: string;
  channel: TouchChannel;
  summary: string;
  notes: string | null;
  by_email: string;
  created_at: string;
};
