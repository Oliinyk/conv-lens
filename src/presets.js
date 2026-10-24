// Ready-made funnels so a site owner never has to write a regular expression.
// Each preset is what the dashboard's setup step fills in; everything stays editable afterwards.
export const PRESETS = {
  woocommerce: {
    label: 'WooCommerce (WordPress)',
    hint: 'Магазин на WordPress. Кроки ловляться по стандартних адресах і кнопках Woo.',
    funnel: [
      { id: 'visit', name: 'Візит', match: { any: true } },
      { id: 'catalog', name: 'Каталог', match: { path: '(/shop|/catalog|/product-category|/categoriya)' } },
      { id: 'product', name: 'Картка товару', match: { path: '(/product/|/tovar/)' } },
      { id: 'add_to_cart', name: 'Додав у кошик', match: { event: 'add_to_cart' } },
      { id: 'cart', name: 'Кошик', match: { path: '(/cart|/koshyk)' } },
      { id: 'checkout', name: 'Оформлення', match: { path: '(/checkout|/oformlennya)' } },
      { id: 'purchase', name: 'Покупка', match: { event: 'purchase' } }
    ],
    ctaSelectors: ['.single_add_to_cart_button', 'button[name=add-to-cart]', '.add_to_cart_button', '.checkout-button', '#place_order', '[data-cl-cta]'],
    autoTrack: [
      { event: 'add_to_cart', clickSelector: '.single_add_to_cart_button, button[name=add-to-cart], .add_to_cart_button' },
      { event: 'begin_checkout', clickSelector: '.checkout-button, a[href*="/checkout"]' }
    ],
    apiErrorPaths: ['(wc-ajax|/cart|/checkout|admin-ajax)'],
    purchasePaths: ['(/checkout/order-received|/thank-you|/dyakuyemo)']
  },

  shopify: {
    label: 'Shopify',
    hint: 'Shopify та його клони: /products, /cart, /checkout.',
    funnel: [
      { id: 'visit', name: 'Візит', match: { any: true } },
      { id: 'catalog', name: 'Каталог', match: { path: '^/collections' } },
      { id: 'product', name: 'Картка товару', match: { path: '^/products/' } },
      { id: 'add_to_cart', name: 'Додав у кошик', match: { event: 'add_to_cart' } },
      { id: 'cart', name: 'Кошик', match: { path: '^/cart' } },
      { id: 'checkout', name: 'Оформлення', match: { path: '(^/checkout|^/checkouts/)' } },
      { id: 'purchase', name: 'Покупка', match: { event: 'purchase' } }
    ],
    ctaSelectors: ['button[name=add]', '.product-form__submit', '[name=checkout]', '[data-cl-cta]'],
    autoTrack: [
      { event: 'add_to_cart', clickSelector: 'button[name=add], .product-form__submit' },
      { event: 'begin_checkout', clickSelector: '[name=checkout], a[href*="/checkout"]' }
    ],
    apiErrorPaths: ['(/cart|/checkout|/api/)'],
    purchasePaths: ['(/orders/|/thank_you)']
  },

  opencart: {
    label: 'OpenCart / Horoshop / Prom-подібні',
    hint: 'Поширені в Україні магазини з адресами index.php?route=… або /cart.',
    funnel: [
      { id: 'visit', name: 'Візит', match: { any: true } },
      { id: 'catalog', name: 'Каталог', match: { path: '(route=product/category|/catalog|/category)' } },
      { id: 'product', name: 'Картка товару', match: { path: '(route=product/product|/product|/p/)' } },
      { id: 'add_to_cart', name: 'Додав у кошик', match: { event: 'add_to_cart' } },
      { id: 'cart', name: 'Кошик', match: { path: '(route=checkout/cart|/cart|/koshyk)' } },
      { id: 'checkout', name: 'Оформлення', match: { path: '(route=checkout|/checkout|/order)' } },
      { id: 'purchase', name: 'Покупка', match: { event: 'purchase' } }
    ],
    ctaSelectors: ['#button-cart', '.btn-cart', '.add-to-cart', '[data-cl-cta]'],
    autoTrack: [
      { event: 'add_to_cart', clickSelector: '#button-cart, .btn-cart, .add-to-cart' }
    ],
    apiErrorPaths: ['(route=checkout|/cart|/api/)'],
    purchasePaths: ['(route=checkout/success|/success|/thank)']
  },

  shop: {
    label: 'Інший магазин',
    hint: 'Універсальні правила: ловить /catalog, /product, /cart, /checkout у більшості CMS.',
    funnel: [
      { id: 'visit', name: 'Візит', match: { any: true } },
      { id: 'catalog', name: 'Каталог', match: { path: '(/catalog|/shop|/products|/category|/collection)' } },
      { id: 'product', name: 'Картка товару', match: { path: '(/product|/tovar|/p/|/item)' } },
      { id: 'add_to_cart', name: 'Додав у кошик', match: { event: 'add_to_cart' } },
      { id: 'cart', name: 'Кошик', match: { path: '(/cart|/koshyk|/basket)' } },
      { id: 'checkout', name: 'Оформлення', match: { path: '(/checkout|/order|/oformlen)' } },
      { id: 'purchase', name: 'Покупка', match: { event: 'purchase' } }
    ],
    ctaSelectors: ['[data-cl-cta]', 'button[type=submit]', '.btn-primary'],
    autoTrack: [
      { event: 'add_to_cart', clickText: '(додати в кошик|в кошик|купити|add to cart|buy now)' }
    ],
    apiErrorPaths: ['(/cart|/checkout|/api/)'],
    purchasePaths: ['(/thank|/success|/dyakuyemo|/spasibo)']
  },

  leadgen: {
    label: 'Сайт послуг / лендінг (заявки)',
    hint: 'Ціль — заявка або дзвінок, а не кошик. Ловить відправку форм і кліки по кнопках зв’язку.',
    funnel: [
      { id: 'visit', name: 'Візит', match: { any: true } },
      { id: 'engaged', name: 'Почитав сторінку', match: { event: 'engaged' } },
      { id: 'contact_intent', name: 'Клік на звʼязок', match: { event: 'contact_intent' } },
      { id: 'form_start', name: 'Почав заповнювати', match: { event: 'form_start' } },
      { id: 'lead', name: 'Відправив заявку', match: { event: 'lead' } }
    ],
    ctaSelectors: ['[data-cl-cta]', 'a[href^="tel:"]', 'a[href^="mailto:"]', 'form button[type=submit]'],
    autoTrack: [
      { event: 'contact_intent', clickText: '(зателефонувати|подзвонити|звʼязатися|звязатися|замовити звінок|contact|call us|get in touch)' },
      { event: 'lead', formSubmit: true }
    ],
    apiErrorPaths: ['(/api/|/wp-json|admin-ajax|/form)'],
    purchasePaths: ['(/thank|/dyakuyemo|/success)']
  },

  custom: {
    label: 'Налаштую сам',
    hint: 'Лише візит і ціль. Кроки додаються руками в налаштуваннях сайту.',
    funnel: [
      { id: 'visit', name: 'Візит', match: { any: true } },
      { id: 'goal', name: 'Ціль', match: { event: 'purchase' } }
    ],
    ctaSelectors: ['[data-cl-cta]'],
    autoTrack: [],
    apiErrorPaths: ['(/api/)'],
    purchasePaths: []
  }
};

export const PRESET_LIST = Object.entries(PRESETS).map(([id, p]) => ({ id, label: p.label, hint: p.hint }));

// A preset's purchasePaths become a funnel/goal rule the tracker can fire without any code on the site:
// landing on the "thank you" page counts as the purchase.
export function presetConfig(id) {
  const p = PRESETS[id] || PRESETS.custom;
  const autoTrack = [...(p.autoTrack || [])];
  for (const path of p.purchasePaths || []) {
    autoTrack.push({ event: 'purchase', path, once: true });
  }
  return {
    preset: PRESETS[id] ? id : 'custom',
    funnel: p.funnel,
    ctaSelectors: p.ctaSelectors,
    autoTrack,
    apiErrorPaths: p.apiErrorPaths
  };
}
