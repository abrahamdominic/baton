-- Migrate 0008: normalize crypto_* fields stored on payment rows.
--
-- Production env values for USDC_NETWORK and USDC_PAYMENT_WALLET_ADDRESS were
-- pasted with trailing newlines into Vercel, and the config schema did not trim
-- them. The untrimmed values were baked into payment rows (crypto_network =
-- 'base\n', crypto_wallet_address = '0x…\n') and displayed/copied on the
-- checkout page, and would break on-chain recipient verification.
--
-- Vanilla SQL only (no pg functions/DDL): this migration is data-only so it can
-- be applied to a deployed Supabase project.

update public.payments
set crypto_network = btrim(crypto_network)
where crypto_network is not null and crypto_network <> btrim(crypto_network);

update public.payments
set crypto_wallet_address = btrim(crypto_wallet_address)
where crypto_wallet_address is not null and crypto_wallet_address <> btrim(crypto_wallet_address);

update public.payments
set crypto_token = btrim(crypto_token)
where crypto_token is not null and crypto_token <> btrim(crypto_token);

update public.plans
set stripe_product_id = btrim(stripe_product_id),
    stripe_monthly_price_id = btrim(stripe_monthly_price_id),
    stripe_annual_price_id = btrim(stripe_annual_price_id)
where (stripe_product_id is not null and stripe_product_id <> btrim(stripe_product_id))
   or (stripe_monthly_price_id is not null and stripe_monthly_price_id <> btrim(stripe_monthly_price_id))
   or (stripe_annual_price_id is not null and stripe_annual_price_id <> btrim(stripe_annual_price_id));