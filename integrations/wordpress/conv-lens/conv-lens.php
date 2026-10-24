<?php
/**
 * Plugin Name: Conv Lens
 * Description: Підключає трекер Conv Lens і передає події WooCommerce у власний колектор. Потрібні лише дві речі: адреса Conv Lens і ключ сайту з його дашборда.
 * Version: 2.0.0
 * Requires PHP: 7.4
 */

if (!defined('ABSPATH')) {
    exit;
}

define('CONV_LENS_OPTION', 'conv_lens_settings');

function conv_lens_settings()
{
    $defaults = [
        'collector' => '',
        'site_key' => '',
        'sample_rate' => 1,
        'exclude_logged_in' => 1,
        'survey' => 1,
    ];
    return wp_parse_args(get_option(CONV_LENS_OPTION, []), $defaults);
}

function conv_lens_enabled()
{
    $s = conv_lens_settings();
    if (empty($s['collector']) || empty($s['site_key'])) {
        return false;
    }
    if (!empty($s['exclude_logged_in']) && is_user_logged_in() && current_user_can('edit_posts')) {
        return false;
    }
    if (is_admin() || (defined('DOING_AJAX') && DOING_AJAX)) {
        return false;
    }
    return true;
}

function conv_lens_enqueue()
{
    if (!conv_lens_enabled()) {
        return;
    }
    $s = conv_lens_settings();
    $base = untrailingslashit($s['collector']);

    $config = [
        'endpoint' => $base . '/cl/collect',
        'sampleRate' => (float) $s['sample_rate'],
    ];
    if (function_exists('get_woocommerce_currency')) {
        $config['currency'] = get_woocommerce_currency();
    }
    if (empty($s['survey'])) {
        $config['survey'] = ['enabled' => false];
    }

    $src = $base . '/cl/t.js?s=' . rawurlencode($s['site_key']);
    wp_register_script('conv-lens', $src, [], null, false);
    wp_add_inline_script(
        'conv-lens',
        'window.convLensConfig=Object.assign(window.convLensConfig||{},' . wp_json_encode($config) . ');',
        'before'
    );
    wp_enqueue_script('conv-lens');
    wp_add_inline_script('conv-lens', conv_lens_bridge(), 'after');
}
add_action('wp_enqueue_scripts', 'conv_lens_enqueue', 1);

function conv_lens_bridge()
{
    $js = <<<'JS'
(function () {
  var q = function () { (window.clQueue = window.clQueue || []).push(arguments); };
  var cl = function () { (window.cl || q).apply(null, arguments); };
  function price(el) {
    var t = (el && el.textContent || '').replace(/[^0-9.,]/g, '').replace(/\s/g, '').replace(',', '.');
    return parseFloat(t) || 0;
  }
  if (window.jQuery) {
    jQuery(document.body).on('added_to_cart', function (e, fragments, hash, button) {
      cl('track', 'add_to_cart', {
        product: button ? button.data('product_id') : null,
        value: price(document.querySelector('.summary .price, .price'))
      });
    });
    jQuery(document.body).on('wc_fragments_refreshed updated_cart_totals', function () {
      cl('track', 'cart_updated', {});
    });
    jQuery(document.body).on('checkout_error', function () {
      cl('track', 'checkout_error', { text: (document.querySelector('.woocommerce-error') || {}).innerText });
    });
    jQuery(document).on('ajaxError', function (e, xhr, settings) {
      cl('track', 'ajax_error', { url: String(settings.url || '').split('?')[0], status: xhr.status });
    });
  }
  document.addEventListener('click', function (ev) {
    var btn = ev.target.closest && ev.target.closest('.single_add_to_cart_button, button[name=add-to-cart]');
    if (btn && !window.jQuery) cl('track', 'add_to_cart', { value: price(document.querySelector('.price')) });
    var coupon = ev.target.closest && ev.target.closest('[name=apply_coupon]');
    if (coupon) cl('track', 'coupon_try', { code: (document.querySelector('#coupon_code') || {}).value || '' });
  }, true);
  var oos = document.querySelector('.stock.out-of-stock');
  if (oos) cl('track', 'out_of_stock_view', { text: oos.textContent.trim().slice(0, 60) });
  var results = document.querySelector('.woocommerce-info.woocommerce-no-products-found, .no-products-found');
  if (results && /[?&]s=/.test(location.search)) cl('track', 'zero_results', { q: new URLSearchParams(location.search).get('s') });
})();
JS;
    return $js;
}

function conv_lens_page_events()
{
    if (!conv_lens_enabled() || !function_exists('is_cart')) {
        return;
    }
    $calls = [];
    if (is_cart()) {
        $calls[] = "cl('track','view_cart',{});";
    }
    if (is_checkout() && !is_order_received_page()) {
        $calls[] = "cl('track','begin_checkout',{});";
    }
    if (is_product()) {
        global $product;
        if ($product) {
            $calls[] = sprintf(
                "cl('track','product_view',%s);",
                wp_json_encode([
                    'id' => $product->get_id(),
                    'name' => wp_strip_all_tags($product->get_name()),
                    'value' => (float) $product->get_price(),
                    'in_stock' => $product->is_in_stock(),
                ])
            );
        }
    }
    if (!$calls) {
        return;
    }
    wp_add_inline_script('conv-lens', "(function(){var cl=function(){(window.cl||function(){(window.clQueue=window.clQueue||[]).push(arguments)}).apply(null,arguments)};" . implode('', $calls) . "})();", 'after');
}
add_action('wp_enqueue_scripts', 'conv_lens_page_events', 20);

function conv_lens_thankyou($order_id)
{
    if (!conv_lens_enabled() || !$order_id) {
        return;
    }
    $order = wc_get_order($order_id);
    if (!$order) {
        return;
    }
    $payload = wp_json_encode([
        'value' => (float) $order->get_total(),
        'currency' => $order->get_currency(),
        'orderId' => $order->get_order_number(),
        'items' => $order->get_item_count(),
        'shipping' => (float) $order->get_shipping_total(),
        'payment' => $order->get_payment_method_title(),
    ]);
    printf(
        '<script>(function(){var f=function(){window.cl && window.cl("goal","purchase",%s)};if(window.cl){f()}else{setTimeout(f,1200)}})();</script>',
        $payload
    );
}
add_action('woocommerce_thankyou', 'conv_lens_thankyou', 10, 1);

function conv_lens_menu()
{
    add_options_page('Conv Lens', 'Conv Lens', 'manage_options', 'conv-lens', 'conv_lens_settings_page');
}
add_action('admin_menu', 'conv_lens_menu');

function conv_lens_settings_page()
{
    if (!current_user_can('manage_options')) {
        return;
    }
    if (isset($_POST['conv_lens_nonce']) && wp_verify_nonce(sanitize_key($_POST['conv_lens_nonce']), 'conv_lens_save')) {
        update_option(CONV_LENS_OPTION, [
            'collector' => untrailingslashit(esc_url_raw(wp_unslash($_POST['collector'] ?? ''))),
            'site_key' => sanitize_text_field(wp_unslash($_POST['site_key'] ?? '')),
            'sample_rate' => max(0.01, min(1, (float) ($_POST['sample_rate'] ?? 1))),
            'exclude_logged_in' => isset($_POST['exclude_logged_in']) ? 1 : 0,
            'survey' => isset($_POST['survey']) ? 1 : 0,
        ]);
        echo '<div class="notice notice-success"><p>Збережено</p></div>';
    }
    $s = conv_lens_settings();
    ?>
    <div class="wrap">
        <h1>Conv Lens</h1>
        <form method="post">
            <?php wp_nonce_field('conv_lens_save', 'conv_lens_nonce'); ?>
            <table class="form-table">
                <tr>
                    <th scope="row"><label for="collector">URL колектора</label></th>
                    <td>
                        <input name="collector" id="collector" type="url" class="regular-text"
                               value="<?php echo esc_attr($s['collector']); ?>" placeholder="https://lens.example.com">
                        <p class="description">Адреса, де працює Conv Lens. Її видно в дашборді.</p>
                    </td>
                </tr>
                <tr>
                    <th scope="row"><label for="site_key">Ключ сайту</label></th>
                    <td>
                        <input name="site_key" id="site_key" type="text" class="regular-text" autocomplete="off"
                               value="<?php echo esc_attr($s['site_key']); ?>" placeholder="напр. a2d68a203b654775c3ecc3f3">
                        <p class="description">Conv Lens → Налаштування → «Код для сайту». Скопіюйте те, що стоїть після <code>?s=</code>.</p>
                    </td>
                </tr>
                <tr>
                    <th scope="row"><label for="sample_rate">Частка відвідувачів</label></th>
                    <td>
                        <input name="sample_rate" id="sample_rate" type="number" step="0.05" min="0.01" max="1"
                               value="<?php echo esc_attr($s['sample_rate']); ?>">
                        <p class="description">1 — писати всіх. 0.25 — кожного четвертого.</p>
                    </td>
                </tr>
                <tr>
                    <th scope="row">Опції</th>
                    <td>
                        <label><input type="checkbox" name="exclude_logged_in" <?php checked($s['exclude_logged_in'], 1); ?>> Не писати редакторів і адмінів</label><br>
                        <label><input type="checkbox" name="survey" <?php checked($s['survey'], 1); ?>> Показувати опитування на виході</label>
                    </td>
                </tr>
            </table>
            <?php submit_button(); ?>
        </form>
    </div>
    <?php
}
