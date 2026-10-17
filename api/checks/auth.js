pm.test('Unauthenticated request is rejected', () => pm.response.to.have.status(401));
pm.test('Error is machine-readable', () => pm.expect(pm.response.json().error.code).to.eql('UNAUTHORIZED'));
