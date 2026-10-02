/**
 * Safe diagnostics for customer wire keys the adapters do not map yet.
 * Only endpoint and field paths are reported; values are never logged.
 */
export type WireObjectShape = {
  readonly [key: string]: WireObjectShape | null;
};

export type UnmappedWireKeyDiagnostic = {
  readonly endpoint: string;
  readonly fieldPath: string;
};

export type UnmappedWireKeySink = (diagnostic: UnmappedWireKeyDiagnostic) => void;

const defaultSink: UnmappedWireKeySink = ({ endpoint, fieldPath }) => {
  console.warn(JSON.stringify({ event: 'unmapped_customer_wire_key', endpoint, fieldPath }));
};

export function reportUnmappedWireKeys(
  endpoint: string,
  value: unknown,
  shape: WireObjectShape,
  sink: UnmappedWireKeySink = defaultSink,
): void {
  inspect(value, shape, endpoint, '', sink);
}

function inspect(
  value: unknown,
  shape: WireObjectShape | null,
  endpoint: string,
  parentPath: string,
  sink: UnmappedWireKeySink,
): void {
  if (shape === null || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const entry of value) inspect(entry, shape, endpoint, parentPath, sink);
    return;
  }
  if (typeof value !== 'object') return;

  for (const [key, child] of Object.entries(value)) {
    const path = parentPath ? `${parentPath}.${key}` : key;
    if (!Object.prototype.hasOwnProperty.call(shape, key)) {
      sink({ endpoint, fieldPath: path });
      continue;
    }
    inspect(child, shape[key] ?? null, endpoint, path, sink);
  }
}

export const agentOrderWireShape: WireObjectShape = {
  orders: {
    id: null,
    increment_id: null,
    name: null,
    email: null,
    payment_status: null,
    shipping_status: null,
    grand_total: null,
    payment_method: null,
    payment: {
      method: null,
      amount: null,
      payment_id: null,
      transaction_status: null,
      gateway_message: null,
      op_code: null,
      origin_bank: null,
      destination_account: { holder: null, bank: null, number: null, cci: null, type: null },
      voucher: null,
      paid_at: null,
    },
    event_id: null,
    currency: null,
    currency_code: null,
    currency_symbol: null,
    event_name: null,
    event_date: null,
    event_url: null,
    items: { gift_name: null, quantity: null, amount: null, row_total: null, type: null },
    created_at: null,
  },
};

export const agentPartitionedOrdersWireShape: WireObjectShape = {
  orders: agentOrderWireShape.orders ?? {},
  completed_orders: agentOrderWireShape.orders ?? {},
  pending_orders: agentOrderWireShape.orders ?? {},
  carts: {
    cart_id: null,
    status: null,
    was_abandoned: null,
    event_id: null,
    event_name: null,
    event_date: null,
    event_url: null,
    subtotal: null,
    currency: null,
    currency_code: null,
    currency_symbol: null,
    gifts_quantity: null,
    items: { gift_name: null, quantity: null, amount: null, row_total: null, type: null },
    created_at: null,
  },
};

const giftPurchaseShape: WireObjectShape = {
  id: null,
  increment_id: null,
  payment_status: null,
  shipping_status: null,
  grand_total: null,
  is_thanked: null,
  payment: {
    method: null,
    amount: null,
    payment_id: null,
    transaction_status: null,
    gateway_message: null,
    op_code: null,
    origin_bank: null,
    destination_account: { holder: null, bank: null, number: null, cci: null, type: null },
    voucher: null,
    paid_at: null,
  },
  decline_code: null,
  admin_comment: null,
  event_id: null,
  currency: null,
  currency_code: null,
  currency_symbol: null,
  event_name: null,
  event_date: null,
  event_url: null,
  items: { gift_name: null, quantity: null, amount: null, row_total: null, type: null },
  dedication: { message: null, is_private: null, send_physical: null, physical_status: null },
  thanks: { message: null, send_method: null },
  created_at: null,
};

export const agentGiftPurchasesWireShape: WireObjectShape = {
  purchases: giftPurchaseShape,
};

export const agentGuestEventsWireShape: WireObjectShape = {
  events: {
    event_id: null,
    name: null,
    slug: null,
    url: null,
    datetime: null,
    type: null,
    type_detail: null,
    stage: null,
    city: null,
    country: null,
    currency: null,
    role: null,
  },
};

const eventDetailShape: WireObjectShape = {
  event_id: null,
  name: null,
  slug: null,
  url: null,
  type: null,
  type_detail: null,
  datetime: null,
  with_time: null,
  timezone: null,
  city: null,
  country: { id: null, name: null, short_code: null },
  currency: null,
  stage: null,
  celebrateds: { name: null, type: null },
  moments: {
    label: null,
    description: null,
    datetime: null,
    with_time: null,
    location_description: null,
    location_reference: null,
    location_url: null,
    location_coords: null,
    position: null,
  },
  dresscode: { type: null, description: null },
  common_asked: { question: null, answer: null },
  contact_info: null,
};

export const agentEventDetailWireShape: WireObjectShape = {
  event: eventDetailShape,
  attendance: {
    guest_id: null,
    name: null,
    has_responded: null,
    will_attend: null,
    response_date: null,
  },
  purchases: giftPurchaseShape,
};

export const agentRecentMessagesWireShape: WireObjectShape = {
  messages: {
    id: null,
    event_id: null,
    direction: null,
    source: null,
    body: null,
    status: null,
    whatsapp_message_id: null,
    sent_at: null,
    created_at: null,
  },
};

const userLookupEventShape: WireObjectShape = {
  id: null,
  event_id: null,
  slug: null,
  url: null,
  name: null,
  datetime: null,
  type: null,
  type_detail: null,
  stage: null,
  is_visible: null,
  is_public: null,
  currency: { id: null, name: null, cod_alpha: null, symbol: null },
  currency_symbol: null,
  country: { id: null, name: null, short_code: null },
  city: null,
  place: null,
  location: null,
  address: null,
  with_time: null,
  timezone: null,
  celebrateds: { name: null, type: null },
  moments: eventDetailShape.moments ?? {},
  dresscode: { type: null, description: null },
  common_asked: { question: null, answer: null },
  contact_info: null,
  amount_collected: null,
  amount_transferred: null,
  transactions_count: null,
  invited_guest: null,
  confirmed_guest: null,
  confirmed_guest_count: null,
};

const userLookupOrderShape: WireObjectShape = {
  id: null,
  event_id: null,
  event_name: null,
  event_date: null,
  event_url: null,
  event: userLookupEventShape,
  currency: { id: null, name: null, cod_alpha: null, symbol: null },
  currency_symbol: null,
  increment_id: null,
  gift_type: null,
  grand_total: null,
  payment_status: null,
  shipping_status: null,
  created_at: null,
  payment_method: { name: null, id: null },
};

export const userLookupWireShape: WireObjectShape = {
  user: { id: null, full_name: null, email: null, full_phone: null },
  events: userLookupEventShape,
  guest_in_events: {
    id: null,
    event_id: null,
    event: userLookupEventShape,
    has_responded: null,
    will_attend: null,
    has_couple: null,
    response_date: null,
    place: null,
    location: null,
    address: null,
    country: { id: null, name: null, short_code: null },
  },
  host_in_events: {
    id: null,
    event_id: null,
    event: userLookupEventShape,
    type: null,
    permission: null,
    status: null,
    place: null,
    location: null,
    address: null,
  },
  celebrated_in: {
    id: null,
    event_id: null,
    event: userLookupEventShape,
    type: null,
  },
  recent_orders: userLookupOrderShape,
};
