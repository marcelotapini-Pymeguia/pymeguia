import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { compute, calcPrecioRec, isRaw, num } = createRequire(import.meta.url)('../calc-engine.js');

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.005 + 1e-9, `${msg || ''} esperado ${b}, obtenido ${a}`);
const byName = (d, re) => d.desglose.find(r => re.test(r.concepto));

// ── Caso de oro: Caxton Printing Press (3 productos, USD -> EUR, Etsy 14,1 %, ChatGPT 22 €/mes) ──
const caxton = {
  version: 2, negocio: 'Caxton Printing Press', moneda: '€', moneda_codigo: 'EUR',
  tipo_cambio: { USD: 0.92 }, margen_elegido: 20,
  fijos_mensuales: [{ concepto: 'Suscripción ChatGPT', monto: 22, moneda: 'EUR', cada_meses: 1 }],
  costos_pct: [{ concepto: 'Comisión Etsy', pct: 14.1 }],
  productos: [
    { producto: 'Camisetas', precio: 48.97, unidades_mes: 5, tiempo_horas: 0.17, valor_hora: 0,
      costos_unit: [{ concepto: 'Impresión proveedor', monto: 25.76, moneda: 'USD' }, { concepto: 'Envío proveedor', monto: 6.09, moneda: 'USD' }] },
    { producto: 'Tote bags', precio: 28, unidades_mes: 5, tiempo_horas: 0.17, valor_hora: 0,
      costos_unit: [{ concepto: 'Impresión proveedor', monto: 12.38, moneda: 'USD' }, { concepto: 'Envío proveedor', monto: 5.89, moneda: 'USD' }] },
    { producto: 'Tazas', precio: 21, unidades_mes: 5, tiempo_horas: 0.17, valor_hora: 0,
      costos_unit: [{ concepto: 'Impresión proveedor', monto: 6.32, moneda: 'USD' }, { concepto: 'Envío proveedor', monto: 8.99, moneda: 'USD' }] }
  ]
};

test('Caxton: desglose, costo, mínimo y recomendado de cada producto', () => {
  const r = compute(caxton);
  assert.equal(r.ok, true, r.errors.join(' | '));
  assert.equal(r.data.modo, 'multi');
  const [cam, tote, taza] = r.data.productos;

  // Camisetas: 25,76*0,92=23,70 | 6,09*0,92=5,60 | 22/15=1,47 | 14,1 % de 48,97 = 6,90
  close(byName(cam, /Impresión/).valor, 23.70);
  close(byName(cam, /Envío/).valor, 5.60);
  close(byName(cam, /Gastos fijos/).valor, 1.47);
  close(byName(cam, /Etsy/).valor, 6.90);
  close(cam.costo_total, 37.67);
  close(cam.precio_minimo, 35.82);       // 30,77 / (1 - 0,141)
  close(cam.precio_recomendado, 46.69);  // 30,77 / (1 - 0,141 - 0,20)

  // Tote bags: 12,38*0,92=11,39 | 5,89*0,92=5,42 | 1,47 | 14,1 % de 28 = 3,95
  close(tote.costo_total, 11.39 + 5.42 + 1.47 + 3.95);
  close(tote.precio_minimo, (11.39 + 5.42 + 1.47) / 0.859);
  close(tote.precio_recomendado, (11.39 + 5.42 + 1.47) / 0.659);

  // Tazas: 6,32*0,92=5,81 | 8,99*0,92=8,27 | 1,47 | 14,1 % de 21 = 2,96
  close(taza.costo_total, 5.81 + 8.27 + 1.47 + 2.96);
  close(taza.precio_minimo, (5.81 + 8.27 + 1.47) / 0.859);
  close(taza.precio_recomendado, (5.81 + 8.27 + 1.47) / 0.659);
});

test('Caxton: ningún porcentaje queda en cero y la suma del desglose es el costo total', () => {
  const r = compute(caxton);
  r.data.productos.forEach(p => {
    p.desglose.filter(x => /%/.test(x.concepto)).forEach(x => assert.ok(x.valor > 0, x.concepto));
    const suma = p.desglose.reduce((s, x) => s + x.valor, 0);
    close(suma, p.costo_total, 'suma del desglose');
  });
});

test('Caxton: consolidado = suma de (precio - costo) × unidades; los fijos se reparten entre 15 uds', () => {
  const r = compute(caxton);
  const esperado = r.data.productos.reduce((s, p) => s + (p.precio_actual - p.costo_total) * p.unidades_mes, 0);
  close(r.data.consolidado.ganancia_mensual, esperado);
  close(r.data.consolidado.ganancia_anual, esperado * 12);
  assert.equal(r.data.consolidado.unidades_mes_total, 15);
  close(r.data.consolidado.costo_fijo_mensual_total, 22);
  assert.equal(r.resumen.tipoCambio[0].moneda, 'USD');
  assert.equal(r.resumen.tipoCambio[0].tasa, 0.92);
});

// ── Caso de oro: Llavero Studio (1 producto, amortización, devoluciones 1 %) ──
const llavero = {
  version: 2, negocio: 'Llavero Studio', moneda: '€', margen_elegido: 30,
  fijos_mensuales: [
    { concepto: 'Internet', monto: 25 },
    { concepto: 'Cuota de autónomo', monto: 290 },
    { concepto: 'Impresora 3D (amortización)', monto: 350, cada_meses: 48 }
  ],
  costos_pct: [{ concepto: 'Comisión Etsy', pct: 9 }, { concepto: 'Devoluciones', pct: 1 }],
  productos: [{ producto: 'Llavero', precio: 12, unidades_mes: 60, tiempo_horas: 0.33, valor_hora: 0,
    costos_unit: [{ concepto: 'Filamento PLA', monto: 0.9 }, { concepto: 'Bolsita con tarjeta', monto: 0.3 }, { concepto: 'Envío', monto: 3.5 }] }]
};

test('Llavero: single, fijos con amortización, comisión y devoluciones', () => {
  const r = compute(llavero);
  assert.equal(r.ok, true, r.errors.join(' | '));
  const d = r.data;
  assert.equal(d.modo, 'single');
  // fijos: 25 + 290 + 350/48 = 322,2917 / 60 = 5,37
  close(byName(d, /Gastos fijos/).valor, 5.37);
  close(byName(d, /Etsy/).valor, 1.08);
  close(byName(d, /Devoluciones/).valor, 0.12);
  close(d.costo_total, 0.90 + 0.30 + 3.50 + 5.37 + 1.08 + 0.12);
  close(d.precio_minimo, 10.07 / 0.90);
  close(d.precio_recomendado, 10.07 / 0.60);
  close(d.ganancia_mensual, (12 - d.costo_total) * 60);
});

// ── Caso de oro: Artesanías Valencia / María (mano de obra sin definir, datáfono 1,5 %) ──
const maria = {
  version: 2, negocio: 'Artesanías Valencia', moneda: '€', margen_elegido: 30,
  fijos_mensuales: [{ concepto: 'Internet', monto: 20 }, { concepto: 'Cuota de autónoma', monto: 290 }],
  costos_pct: [{ concepto: 'Comisión datáfono', pct: 1.5 }],
  productos: [{ producto: 'Cesta de mimbre', precio: 45, unidades_mes: 20, tiempo_horas: 3, valor_hora: 0,
    costos_unit: [{ concepto: 'Mimbre', monto: 30 }, { concepto: 'Bolsa de papel y etiqueta', monto: 2 }] }]
};

test('María: sin valor hora no entra mano de obra; pierde dinero y el mínimo es consistente', () => {
  const r = compute(maria);
  assert.equal(r.ok, true, r.errors.join(' | '));
  const d = r.data;
  assert.equal(byName(d, /Mano de obra/), undefined);
  close(byName(d, /Gastos fijos/).valor, 15.5);
  close(byName(d, /datáfono/).valor, 0.68);
  close(d.costo_total, 48.18);
  assert.ok(d.precio_actual < d.costo_total, 'pierde dinero');
  close(d.precio_minimo, 47.5 / 0.985);
  close(d.precio_recomendado, 47.5 / 0.685);
});

test('María: con valor hora definido la mano de obra entra al costo', () => {
  const conHora = structuredClone(maria);
  conHora.productos[0].valor_hora = 10;
  const d = compute(conHora).data;
  close(byName(d, /Mano de obra/).valor, 30);
  close(d.costo_total, 78.18);
});

// ── Robustez ──
test('Falta de tipo de cambio: error claro, no un número inventado', () => {
  const x = structuredClone(caxton);
  delete x.tipo_cambio;
  const r = compute(x);
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /tipo de cambio de USD/);
});

test('Números escritos como texto con coma o símbolo se interpretan igual', () => {
  assert.equal(num('25,76'), 25.76);
  assert.equal(num('€48,97'), 48.97);
  assert.equal(num('1.234,56'), 1234.56);
  assert.equal(num('1,234.56'), 1234.56);
  assert.ok(Number.isNaN(num('mucho')));
  const x = structuredClone(maria);
  x.productos[0].precio = '45,00';
  x.productos[0].costos_unit[0].monto = '30,00';
  close(compute(x).data.costo_total, 48.18);
});

test('Sin unidades, sin precio o con monto ilegible: se rechaza', () => {
  const a = structuredClone(maria); a.productos[0].unidades_mes = 0;
  assert.equal(compute(a).ok, false);
  const b = structuredClone(maria); b.productos[0].precio = 'varía';
  assert.equal(compute(b).ok, false);
  const c = structuredClone(maria); c.productos[0].costos_unit[0].monto = 'unos cuantos';
  assert.equal(compute(c).ok, false);
});

test('Un nombre con "%" en un costo que no es porcentual no se confunde con comisión', () => {
  const x = structuredClone(maria);
  x.productos[0].costos_unit[0].concepto = 'Mimbre 100% natural';
  const d = compute(x).data;
  assert.equal(byName(d, /Mimbre/).concepto.includes('%'), false);
  close(d.precio_minimo, 47.5 / 0.985);
});

test('cantidad y rinde: 2 bolsas de un pack de 100 a 20 € = 0,40 por unidad', () => {
  const x = structuredClone(maria);
  x.productos[0].costos_unit.push({ concepto: 'Bolsas', monto: 20, cantidad: 2, rinde: 100 });
  close(byName(compute(x).data, /Bolsas/).valor, 0.40);
});

test('Comisiones + margen que dejan el precio sin sentido generan advertencia', () => {
  const x = structuredClone(maria);
  x.margen_elegido = 40;
  x.costos_pct = [{ concepto: 'Plataforma', pct: 55 }];
  const r = compute(x);
  assert.equal(r.ok, true);
  assert.ok(r.warnings.length > 0);
});

test('Propiedad: al precio recomendado el margen real es el elegido (±1 céntimo de precio)', () => {
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 300; i++) {
    const pctA = Math.round(rnd() * 20 * 10) / 10, pctB = Math.round(rnd() * 15 * 10) / 10;
    const margen = [0, 20, 30, 40][Math.floor(rnd() * 4)];
    const raw = {
      version: 2, negocio: 'T', moneda: '€', margen_elegido: margen,
      fijos_mensuales: [{ concepto: 'Fijo', monto: Math.round(rnd() * 1000) }],
      costos_pct: [{ concepto: 'A', pct: pctA }, { concepto: 'B', pct: pctB }],
      productos: [{ producto: 'P', precio: 10 + Math.round(rnd() * 90), unidades_mes: 1 + Math.floor(rnd() * 50),
        costos_unit: [{ concepto: 'Material', monto: Math.round(rnd() * 3000) / 100 + 0.5 }] }]
    };
    const r = compute(raw);
    if (!r.ok) continue;
    const d = r.data;
    const P = d.precio_recomendado;
    const noPct = d.desglose.filter(x => !/%/.test(x.concepto)).reduce((s, x) => s + x.valor, 0);
    const costoAlRec = noPct + (pctA + pctB) / 100 * P;
    const margenReal = (P - costoAlRec) / P * 100;
    assert.ok(Math.abs(margenReal - margen) < 0.2, `margen ${margenReal.toFixed(3)} vs ${margen} (caso ${i})`);
  }
});

test('isRaw distingue el formato nuevo del anterior', () => {
  assert.equal(isRaw(caxton), true);
  assert.equal(isRaw({ modo: 'single', precio_actual: 10, desglose: [{ concepto: 'a', valor: 1 }] }), false);
  assert.equal(isRaw({ modo: 'multi', productos: [{ producto: 'x', precio_actual: 1, desglose: [] }] }), false);
});

test('calcPrecioRec: igual que la fórmula original de la app', () => {
  const items = [{ concepto: 'Material', valor: 10 }, { concepto: 'Comisión 10%', valor: 2 }];
  const r = calcPrecioRec(items, 12, 20);
  close(r.prec, 10 / 0.7);
  close(r.costoReal, 10 + 0.1 * r.prec);
  close(calcPrecioRec([{ concepto: 'Material', valor: 10 }], 10, 20).prec, 12.5);
});

test('El porcentaje se muestra con coma y calcPrecioRec lo entiende con coma o con punto', () => {
  const d = compute(caxton).data.productos[0];
  assert.match(byName(d, /Etsy/).concepto, /14,1%/);
  const a = calcPrecioRec([{ concepto: 'Material', valor: 10 }, { concepto: 'Comisión 14,1%', valor: 1 }], 11, 20).prec;
  const b = calcPrecioRec([{ concepto: 'Material', valor: 10 }, { concepto: 'Comisión 14.1%', valor: 1 }], 11, 20).prec;
  assert.equal(a, b);
});
