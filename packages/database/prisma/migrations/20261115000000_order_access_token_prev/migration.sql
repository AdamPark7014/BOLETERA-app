-- Token de acceso anterior de la orden (gracia de 24 h tras rotarlo al enviar el correo).
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "accessTokenPrevHash" TEXT;
