-- Añadir columnas para información de facturación a la tabla 'reservas'
-- Todas las columnas permiten valores NULL según el requerimiento.

ALTER TABLE reservas
ADD COLUMN tipo_documento VARCHAR(10),      -- Para 'boleta' o 'factura'
ADD COLUMN facturacion_rut VARCHAR(20),       -- RUT para la factura
ADD COLUMN facturacion_razon_social VARCHAR(255), -- Razón Social para la factura
ADD COLUMN facturacion_direccion TEXT,        -- Dirección de facturación
ADD COLUMN facturacion_giro VARCHAR(255);     -- Giro comercial para la factura
