pm.test('Readiness responds 200', () => pm.response.to.have.status(200));
pm.test('Service is ready', () => pm.expect(pm.response.json().status).to.eql('ready'));
