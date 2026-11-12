import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const file = new URL('../workflows/quielstudio-contactos.json', import.meta.url);
const workflow = JSON.parse(readFileSync(file, 'utf8'));
const node = name => workflow.nodes.find(item => item.name === name);
const parseContacts = text => JSON.parse(JSON.stringify(runInNewContext(
  `(function () { ${node('Code in JavaScript').parameters.jsCode}\n})()`,
  { $json: { body: { data: { message: { conversation: text } } } } },
  { timeout: 1000 },
)));

function expression(value, json) {
  if (!value.startsWith('=')) return value;
  return value.slice(1).replace(/\{\{([\s\S]*?)\}\}/g, (_, source) =>
    String(runInNewContext(source, { $json: json }, { timeout: 1000 })),
  );
}

test('las conexiones apuntan a nodos existentes y el flujo se importa inactivo', () => {
  const names = new Set(workflow.nodes.map(item => item.name));
  assert.equal(workflow.active, false);
  assert.equal(names.size, workflow.nodes.length);
  for (const [source, connections] of Object.entries(workflow.connections)) {
    assert(names.has(source), `Origen desconocido: ${source}`);
    for (const output of connections.main ?? []) {
      for (const connection of output) assert(names.has(connection.node));
    }
  }
});

test('procesa ambas secciones y distingue los tres canales de contacto', () => {
  const input = readFileSync(new URL('../examples/lista-contactos.txt', import.meta.url), 'utf8');
  const items = parseContacts(input).map(item => item.json);
  assert.equal(items.length, 3);
  assert.deepEqual(items.map(item => item.canal), ['ambos', 'email', 'whatsapp']);
  assert.deepEqual(items.map(item => item.tipo), ['con_web', 'con_web', 'sin_web']);
  assert.equal(items[1].telefono, '');
  assert.equal(items[2].email, '');
});

test('marca como invalidos los contactos sin datos o sin seccion', () => {
  const cases = [
    'LISTA\ncon_web\nSin datos,,',
    'LISTA\nContacto sin seccion,50760000000,',
    'LISTA\nsin_web\nCorreo incorrecto,,no-es-un-correo',
  ];
  for (const input of cases) assert.equal(parseContacts(input)[0].json.canal, 'invalido');
});

test('una lista vacia no produce destinatarios', () => {
  assert.deepEqual(parseContacts('LISTA\n'), []);
});

test('ambas plantillas producen asunto y cuerpo con el nombre del contacto', () => {
  const email = node('Email').parameters;
  assert.equal(email.emailFormat, 'text');
  for (const name of ['con web', 'sin web']) {
    const contact = { nombre: 'Contacto de prueba', email: 'prueba@example.com' };
    for (const assignment of node(name).parameters.assignments.assignments) {
      assert.equal(assignment.name, assignment.name.trim());
      contact[assignment.name] = expression(assignment.value, contact);
    }
    assert(expression(email.subject, contact).trim());
    const body = expression(email.text, contact);
    assert(body.includes(contact.nombre));
    assert(!/undefined|\{\{/.test(body));
    assert.equal(expression(email.toEmail, contact), contact.email);
  }
});

test('el export no incluye credenciales, datos fijados ni grupos privados', () => {
  const source = JSON.stringify(workflow);
  for (const item of workflow.nodes) assert.equal(item.credentials, undefined);
  assert.deepEqual(workflow.pinData, {});
  assert(!/\d{8,}@(g\.us|s\.whatsapp\.net)/.test(source));
  assert(!/"(?:apikey|password|access_token|refresh_token)"\s*:/i.test(source));
  assert(source.includes('CONFIGURA_EL_GRUPO@g.us'));
  assert.equal(node('Email').parameters.fromEmail, 'Quiel Studio <correo@example.com>');
});
