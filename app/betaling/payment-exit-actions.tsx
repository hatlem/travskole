'use client';

import { BuyerNextActions, PayNowButtons, ReceiptSummaryCard, useStoredReceipt } from '@/components/ReceiptView';

interface PaymentExitActionsProps {
  /** Betalingen er bekreftet mottatt. */
  paid?: boolean;
  /** Vis betal-knapper på nytt (avbrutt/feilet betaling). */
  offerRetry?: boolean;
}

/**
 * Handlinger etter betaling: kvitteringen fra denne økten (hvis den finnes),
 * nytt betalingsforsøk, og Min side / innloggingslenke — aldri en innloggingsmur.
 */
export function PaymentExitActions({ paid = false, offerRetry = false }: PaymentExitActionsProps) {
  const { receipt } = useStoredReceipt();
  return (
    <div className="mt-6 space-y-6">
      {receipt && <ReceiptSummaryCard receipt={paid ? { ...receipt, payment: 'online' } : receipt} paid={paid} />}
      {offerRetry && receipt && !paid && <PayNowButtons receipt={receipt} />}
      <BuyerNextActions email={receipt?.email} kind={receipt?.kind} />
    </div>
  );
}
