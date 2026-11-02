'use strict';
// 보증서·사용자·테스트 결과 저장소
//  - STORE=local (기본): store/ 폴더(보증서)와 results/ 폴더(테스트 결과)에 파일로 저장 (Firebase 없이 바로 데모 가능)
//  - STORE=firestore   : Firebase Firestore 에 저장. `npm install firebase-admin` 과 서비스 계정 키가 필요합니다.
// 두 저장소는 같은 함수 이름을 가지므로 서버 코드는 어느 쪽인지 몰라도 됩니다.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..'); // 저장소 루트 (store/, results/)
const safe = (s) => String(s || '').normalize('NFC').replace(/[^\w가-힣-]+/g, '_').slice(0, 40);

function localStore(dir, resultsDir) {
  const certDir = path.join(dir, 'certificates');
  const photoDir = path.join(dir, 'photos');
  const userDir = path.join(dir, 'users');
  const readJson = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
  // 서버가 켜진 채로 store/ 를 지워도 다시 만들어지도록 쓸 때마다 폴더를 확인합니다.
  const writeJson = (f, obj) => {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(obj, null, 2));
  };

  return {
    kind: 'local',
    where: dir,
    async createCertificate(cert, photos) {
      const pd = path.join(photoDir, safe(cert.id));
      fs.mkdirSync(pd, { recursive: true });
      photos.forEach((p, i) => fs.writeFileSync(path.join(pd, `${i}.jpg`), p.buffer));
      writeJson(path.join(certDir, `${safe(cert.id)}.json`), cert);
      return cert;
    },
    async getCertificate(id) {
      return readJson(path.join(certDir, `${safe(id)}.json`));
    },
    async updateCertificate(id, patch) {
      const f = path.join(certDir, `${safe(id)}.json`);
      const cur = readJson(f);
      if (!cur) return null;
      const next = { ...cur, ...patch };
      writeJson(f, next);
      return next;
    },
    async listCertificates({ limit = 50 } = {}) {
      if (!fs.existsSync(certDir)) return [];
      return fs.readdirSync(certDir)
        .filter((n) => n.endsWith('.json'))
        .map((n) => readJson(path.join(certDir, n)))
        .sort((a, b) => String(b.issuedAt).localeCompare(String(a.issuedAt)))
        .slice(0, limit);
    },
    async getPhoto(id, n) {
      const f = path.join(photoDir, safe(id), `${Number(n)}.jpg`);
      return fs.existsSync(f) ? { buffer: fs.readFileSync(f), mime: 'image/jpeg' } : null;
    },
    async getUser(nickname) {
      return readJson(path.join(userDir, `${safe(nickname)}.json`));
    },
    async saveUser(user) {
      writeJson(path.join(userDir, `${safe(user.nickname)}.json`), user);
      return user;
    },
    // ① 테스트 결과. name = '2026-11-02T15-08-06_이름_세션' (확장자 없음)
    async saveReport(name, report, image) {
      fs.mkdirSync(resultsDir, { recursive: true });
      if (image) fs.writeFileSync(path.join(resultsDir, `${name}.jpg`), image);
      const text = JSON.stringify(report, null, 2);
      fs.writeFileSync(path.join(resultsDir, `${name}.json`), text);
      fs.writeFileSync(path.join(resultsDir, 'latest.json'), text);
    },
    async listReports() {
      if (!fs.existsSync(resultsDir)) return [];
      return fs.readdirSync(resultsDir).filter((n) => n.endsWith('.json') && n !== 'latest.json').map((n) => n.slice(0, -5)).sort().reverse();
    },
    async getReport(name) {
      return readJson(path.join(resultsDir, `${path.basename(name)}.json`));
    },
    async getReportImage(name) {
      const f = path.join(resultsDir, `${path.basename(name)}.jpg`);
      return fs.existsSync(f) ? fs.readFileSync(f) : null;
    },
  };
}

// Firestore 문서 한 개는 1MiB 가 한도라 사진은 별도 컬렉션(certificatePhotos)에 base64 로 나눠 저장합니다.
const FIRESTORE_PHOTO_LIMIT = 900 * 1024;

function firestoreStore() {
  let admin;
  try { admin = require('firebase-admin'); }
  catch { throw new Error('STORE=firestore 를 쓰려면 먼저 `npm install firebase-admin` 을 실행하세요'); }
  if (!admin.apps.length) {
    const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT;
    const credential = keyPath
      ? admin.credential.cert(JSON.parse(fs.readFileSync(path.resolve(ROOT, keyPath), 'utf8')))
      : admin.credential.applicationDefault();
    admin.initializeApp({ credential, projectId: process.env.FIREBASE_PROJECT_ID || undefined });
  }
  const db = admin.firestore();
  const certs = db.collection('certificates');
  const photos = db.collection('certificatePhotos');
  const users = db.collection('users');
  const reports = db.collection('reports');
  const reportPhotos = db.collection('reportPhotos');

  return {
    kind: 'firestore',
    where: `Firestore (${process.env.FIREBASE_PROJECT_ID || '서비스 계정의 프로젝트'})`,
    async createCertificate(cert, photoList) {
      const batch = db.batch();
      photoList.forEach((p, i) => {
        if (p.buffer.length > FIRESTORE_PHOTO_LIMIT) return; // 너무 큰 사진은 건너뜀 (cert.photos[i].skipped 로 표시됨)
        batch.set(photos.doc(`${cert.id}_${i}`), { certificateId: cert.id, index: i, mime: p.mime, data: p.buffer.toString('base64') });
      });
      batch.set(certs.doc(cert.id), cert);
      await batch.commit();
      return cert;
    },
    async getCertificate(id) {
      const s = await certs.doc(String(id)).get();
      return s.exists ? s.data() : null;
    },
    async updateCertificate(id, patch) {
      const ref = certs.doc(String(id));
      const s = await ref.get();
      if (!s.exists) return null;
      await ref.update(patch);
      return { ...s.data(), ...patch };
    },
    async listCertificates({ limit = 50 } = {}) {
      const q = await certs.orderBy('issuedAt', 'desc').limit(limit).get();
      return q.docs.map((d) => d.data());
    },
    async getPhoto(id, n) {
      const s = await photos.doc(`${id}_${Number(n)}`).get();
      return s.exists ? { buffer: Buffer.from(s.data().data, 'base64'), mime: s.data().mime } : null;
    },
    async getUser(nickname) {
      const s = await users.doc(safe(nickname)).get();
      return s.exists ? s.data() : null;
    },
    async saveUser(user) {
      await users.doc(safe(user.nickname)).set(user);
      return user;
    },
    // 결과 JSON 은 문자열로 저장 (Firestore 의 중첩 배열·undefined 제약을 피함)
    async saveReport(name, report, image) {
      const batch = db.batch();
      batch.set(reports.doc(name), { name, savedAt: new Date().toISOString(), json: JSON.stringify(report) });
      // ponytail: 900KB 넘는 테스트 사진은 저장 안 함(보증서에 테스트 사진만 빠짐). 늘 크면 Cloud Storage 로
      if (image && image.length <= FIRESTORE_PHOTO_LIMIT) batch.set(reportPhotos.doc(name), { data: image.toString('base64') });
      await batch.commit();
    },
    async listReports() {
      const q = await reports.orderBy('savedAt', 'desc').limit(100).select('name').get();
      return q.docs.map((d) => d.get('name'));
    },
    async getReport(name) {
      const s = await reports.doc(String(name)).get();
      return s.exists ? JSON.parse(s.get('json')) : null;
    },
    async getReportImage(name) {
      const s = await reportPhotos.doc(String(name)).get();
      return s.exists ? Buffer.from(s.get('data'), 'base64') : null;
    },
  };
}

function createStore() {
  const kind = (process.env.STORE || 'local').trim().toLowerCase();
  if (kind === 'firestore') return firestoreStore();
  return localStore(path.join(ROOT, 'store'), path.join(ROOT, 'results'));
}

module.exports = { createStore, FIRESTORE_PHOTO_LIMIT };
