-- Paso 1: Crear la tabla 'cupones'
CREATE TABLE cupones (
  id SERIAL PRIMARY KEY,
  codigo VARCHAR(50) UNIQUE NOT NULL,
  tipo_descuento VARCHAR(20) NOT NULL, -- 'porcentaje' o 'fijo'
  valor_descuento NUMERIC(10, 2) NOT NULL,
  fecha_validez_desde DATE,
  fecha_validez_hasta DATE,
  usos_maximos INTEGER,
  usos_actuales INTEGER DEFAULT 0 NOT NULL,
  activo BOOLEAN DEFAULT TRUE NOT NULL,
  monto_minimo_reserva_neto NUMERIC(10, 2) DEFAULT 0 NOT NULL,
  descripcion TEXT,
  fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT chk_tipo_descuento CHECK (tipo_descuento IN ('porcentaje', 'fijo')),
  CONSTRAINT chk_valor_descuento_positivo CHECK (valor_descuento > 0),
  CONSTRAINT chk_usos_actuales_no_supera_maximos CHECK (usos_actuales <= usos_maximos OR usos_maximos IS NULL)
);

-- Paso 2: Actualizar la tabla 'reservas' para incluir información del cupón
ALTER TABLE reservas
ADD COLUMN cupon_aplicado_id INTEGER REFERENCES cupones(id) ON DELETE SET NULL,
ADD COLUMN monto_descuento_aplicado NUMERIC(10, 2);
