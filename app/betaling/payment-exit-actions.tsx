'use client';

import { BuyerNextActions, PayNowButtons, ReceiptSummaryCard, useStoredReceipt } from '@/components/ReceiptView';
import { receiptForSubject, type ReceiptSubject } from '@/lib/receipt';

interface PaymentExitActionsProps {
  /** Betalingen er bekreftet mottatt. */
  paid?: boolean;
  /** Vis betal-knapper på nytt (avbrutt/feilet betaling). */
  offerRetry?: boolean;
  /** Raden betalingen gjaldt; uten den vises ingen kvittering. */
  subject: ReceiptSubject | null;
}

/**
 * Handlinger etter betaling: kvitteringen fra denne økten (hvis den gjelder denne betalingen),
 * nytt betalingsforsøk, og Min side / innloggingslenke — aldri en innloggingsmur.
 */
export function PaymentExitActions({ paid = false, offerRetry = false, subject }: PaymentExitActionsProps) {
  const receipt = receiptForSubject(useStoredReceipt().receipt, subject);
  return (
    <div className="mt-6 space-y-6">
      {receipt && <ReceiptSummaryCard receipt={paid ? { ...receipt, payment: 'online' } : receipt} paid={paid} />}
      {offerRetry && receipt && !paid && <PayNowButtons receipt={receipt} />}
      <BuyerNextActions email={receipt?.email} kind={receipt?.kind} hasAccount={receipt?.hasAccount} />
    </div>
  );
}
