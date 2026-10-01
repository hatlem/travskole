'use client';

import { useState } from 'react';
import { Field } from './CrmDialog';
import { TagInput } from './TagInput';
import { Button } from '../Button';

export interface ContactEditValues {
  name: string;
  email: string | null;
  phone: string | null;
  roleTitle: string | null;
  tags: string[];
}

interface ContactEditFormProps {
  contact: ContactEditValues;
  saving: boolean;
  onCancel: () => void;
  /** Kalles med kun endrede felter, klare for PATCH /api/admin/crm/contacts/[id]. */
  onSave: (changed: Record<string, unknown>) => void;
  tagSuggestions?: string[];
}

const blankToNull = (v: string) => (v.trim() === '' ? null : v.trim());

export function ContactEditForm({ contact, saving, onCancel, onSave, tagSuggestions }: ContactEditFormProps) {
  const [name, setName] = useState(contact.name);
  const [email, setEmail] = useState(contact.email ?? '');
  const [phone, setPhone] = useState(contact.phone ?? '');
  const [roleTitle, setRoleTitle] = useState(contact.roleTitle ?? '');
  const [tags, setTags] = useState(contact.tags);

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
    if (JSON.stringify(tags) !== JSON.stringify(contact.tags)) changed.tags = tags;
    onSave(changed);
  }

  return (
    <form
      className="border border-gray-200 rounded-lg p-4 bg-gray-50"
      aria-label="Rediger kontaktinformasjon"
      onSubmit={(e) => { e.preventDefault(); submit(); }}
    >
      <div className="grid md:grid-cols-2 gap-3">
        <Field label="Navn" htmlFor="contact-name">
          <input id="contact-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full bg-white" />
        </Field>
        <Field label="E-post" htmlFor="contact-email" hint={emailInvalid ? 'Sjekk e-postadressen — den ser ikke riktig ut (f.eks. navn@firma.no)' : undefined}>
          <input id="contact-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            className={`border rounded-md px-3 py-1.5 text-sm w-full bg-white ${emailInvalid ? 'border-red-400' : 'border-gray-300'}`} />
        </Field>
        <Field label="Telefon (valgfri)" htmlFor="contact-phone">
          <input id="contact-phone" type="tel" inputMode="tel" placeholder="F.eks. 900 00 001" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full bg-white" />
        </Field>
        <Field label="Rolle eller tittel (valgfri)" htmlFor="contact-role">
          <input id="contact-role" value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} maxLength={100}
            placeholder="F.eks. daglig leder"
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full bg-white" />
        </Field>
        <div className="md:col-span-2">
          <Field label="Stikkord" htmlFor="contact-tags" hint="Skriv et ord og trykk Enter, f.eks. «ponni» eller «julebord-2025». Brukes til å finne og gruppere kontakter.">
            <div className="bg-white rounded-md">
              <TagInput id="contact-tags" value={tags} onChange={setTags} suggestions={tagSuggestions} />
            </div>
          </Field>
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={saving}>Avbryt</Button>
        <Button size="sm" type="submit" disabled={!valid} loading={saving} loadingLabel="Lagrer …">
          Lagre endringer
        </Button>
      </div>
    </form>
  );
}
