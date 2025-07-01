-- Cambios en la tabla 'espacios'
ALTER TABLE espacios
RENAME COLUMN precio_por_hora TO precio_neto_por_hora;

ALTER TABLE espacios
RENAME COLUMN precio_socio_por_hora TO precio_neto_socio_por_hora;

-- Importante: Ejecutar este UPDATE DESPUÉS de los RENAME anteriores.
-- Este comando asume que los precios almacenados ANTES de este script eran precios TOTALES (con IVA incluido).
-- Y los convierte a precios NETOS, redondeando al entero más cercano.
UPDATE espacios SET
  precio_neto_por_hora = ROUND(precio_neto_por_hora / 1.19),
  precio_neto_socio_por_hora = ROUND(precio_neto_socio_por_hora / 1.19);

-- Cambios en la tabla 'reservas'
ALTER TABLE reservas
RENAME COLUMN costo_total TO costo_total_historico;

ALTER TABLE reservas
ADD COLUMN costo_neto_historico NUMERIC(10, 2);

ALTER TABLE reservas
ADD COLUMN costo_iva_historico NUMERIC(10, 2);
