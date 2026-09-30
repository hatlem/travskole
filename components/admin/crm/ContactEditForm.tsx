'use client';

import { useState } from 'react';
import { Field } from './CrmDialog';
import { EntityPicker, type EntityRef } from './EntityPicker';
import { TagInput } from './TagInput';
import { AssigneeSelect } from './AssigneeSelect';

export interface ContactEditValues {
  name: string;
  email: string | null;
  phone: string | null;
  roleTitle: string | null;
  stage: string;
  tags: string[];
  ownerId: number | null;
  organization: EntityRef | null;
}

interface ContactEditFormProps {
  contact: ContactEditValues;
  saving: boolean;
  onCancel: () => void;
  /** Kalles med kun endrede felter, klare for PATCH /api/admin/crm/contacts/[id]. */
  onSave: (changed: Record<string, unknown>) => void;
  tagSuggestions?: string[];
}

const STAGES = [
  { value: 'lead', label: 'Interessent' }, { value: 'active', label: 'Aktiv' },
  { value: 'customer', label: 'Kunde' }, { value: 'dormant', label: 'Sovende' },
  { value: 'lost', label: 'Tapt' },
];

const blankToNull = (v: string) => (v.trim() === '' ? null : v.trim());

export function ContactEditForm({ contact, saving, onCancel, onSave, tagSuggestions }: ContactEditFormProps) {
  const [name, setName] = useState(contact.name);
  const [email, setEmail] = useState(contact.email ?? '');
  const [phone, setPhone] = useState(contact.phone ?? '');
  const [roleTitle, setRoleTitle] = useState(contact.roleTitle ?? '');
  const [stage, setStage] = useState(contact.stage);
  const [tags, setTags] = useState(contact.tags);
  const [ownerId, setOwnerId] = useState(contact.ownerId);
  const [organization, setOrganization] = useState(contact.organization);

  const emailValue = blankToNull(email)?.toLowerCase() ?? null;
  const emailInvalid = emailValue !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue);
  const valid = name.trim() !== '' && !emailInvalid;

  function submit() {
    if (!valid || saving) return;
    const changed: Record<string, unknown> = {};
    if (name.trim() !== contact.name) changed.name = name.trim();
    if (emailValue !== contact.email) changed.email = emailValue;
    if (blankToNull(phone) !== contact.phone) changed.phone = blankToNull(phone);
    if (blankToNull(roleTitle) !== contact.roleTitle) changed.roleTitle = blankToNull(roleTitle);
    if (stage !== contact.stage) changed.stage = stage;
    if (JSON.stringify(tags) !== JSON.stringify(contact.tags)) changed.tags = tags;
    if (ownerId !== contact.ownerId) changed.ownerId = ownerId;
    if ((organization?.id ?? null) !== (contact.organization?.id ?? null)) changed.organizationId = organization?.id ?? null;
    onSave(changed);
  }

  return (
    <form
      className="border border-gray-200 rounded-lg p-4 mb-6 bg-gray-50"
      onSubmit={(e) => { e.preventDefault(); submit(); }}
    >
      <div className="grid md:grid-cols-2 gap-3">
        <Field label="Navn *" htmlFor="contact-name">
          <input id="contact-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full bg-white" />
        </Field>
        <Field label="E-post" htmlFor="contact-email" hint={emailInvalid ? 'Ugyldig e-postadresse' : undefined}>
          <input id="contact-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            className={`border rounded-md px-3 py-1.5 text-sm w-full bg-white ${emailInvalid ? 'border-red-400' : 'border-gray-300'}`} />
        </Field>
        <Field label="Telefon" htmlFor="contact-phone">
          <input id="contact-phone" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full bg-white" />
        </Field>
        <Field label="Rolle/tittel" htmlFor="contact-role">
          <input id="contact-role" value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} maxLength={100}
            placeholder="f.eks. Arrangementsansvarlig"
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full bg-white" />
        </Field>
        <Field label="Bedrift">
          <EntityPicker kind="organization" value={organization} onChange={setOrganization} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Stadium" htmlFor="contact-stage">
            <select id="contact-stage" value={stage} onChange={(e) => setStage(e.target.value)}
              className="border border-gray-300 rounded-md px-2 py-1.5 text-sm w-full bg-white">
              {STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </Field>
          <Field label="Ansvarlig" htmlFor="contact-owner">
            <AssigneeSelect id="contact-owner" value={ownerId} onChange={setOwnerId}
              className="border border-gray-300 rounded-md px-2 py-1.5 text-sm w-full bg-white" />
          </Field>
        </div>
        <div className="md:col-span-2">
          <Field label="Tagger" htmlFor="contact-tags" hint="Enter eller komma for å legge til">
            <div className="bg-white rounded-md">
              <TagInput id="contact-tags" value={tags} onChange={setTags} suggestions={tagSuggestions} />
            </div>
          </Field>
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button type="button" onClick={onCancel} disabled={saving} className="text-sm text-gray-600 px-3 py-1.5">Avbryt</button>
        <button type="submit" disabled={!valid || saving}
          className="bg-bjerke-blue text-white px-4 py-1.5 rounded-md text-sm disabled:opacity-50">
          {saving ? 'Lagrer …' : 'Lagre endringer'}
        </button>
      </div>
    </form>
  );
}
