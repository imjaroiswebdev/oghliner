var assert = require('assert');
var expect = require('chai').expect;
var path = require('path');
var fse = require('fs-extra');
var childProcess = require('child_process');
var readYaml = require('read-yaml');
var temp = require('temp').track();
var readlineSync = require('readline-sync');

var GitHub = require('github');
var github = new GitHub({
  version: '3.0.0',
  protocol: 'https',
  headers: {
    'user-agent': 'Oghliner',
  },
});

var username = process.env.USER, password = process.env.PASS;
var githubToken, githubTokenId;
var useOTP = false;

// Skip these tests if the USER or PASS environment variables aren't set.
if (!username || !password) {
  return;
}

function createRepo() {
  return new Promise(function(resolve, reject) {
    github.repos.create({
      name: 'test_oghliner_live',
      auto_init: true,
    }, function(err) {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

function deleteRepo() {
  return new Promise(function(resolve, reject) {
    github.repos.delete({
      user: username,
      repo: 'test_oghliner_live',
    }, function(err) {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

function getBranch() {
  return new Promise(function(resolve, reject) {
    setTimeout(function() {
      github.repos.getBranch({
        user: username,
        repo: 'test_oghliner_live',
        branch: 'gh-pages',
      }, function(err, res) {
        if (err) {
          reject(err);
        } else {
          resolve(res);
        }
      });
    }, 3000);
  });
}

function spawn(command, args, expected) {
  return new Promise(function(resolve, reject) {
    var child = childProcess.spawn(command, args);

    child.stdout.on('data', function(chunk) {
      process.stdout.write(chunk);
    });

    child.stderr.on('data', function(chunk) {
      process.stderr.write(chunk);
    });

    if (expected) {
      var output = '';
      var nextExpected = expected.shift();

      child.stdout.on('data', function(chunk) {
        output += chunk.toString();

        if (nextExpected && output.indexOf(nextExpected.q) != -1) {
          if (typeof nextExpected.r === 'function') {
            child.stdin.write(nextExpected.r() + '\n');
          } else {
            child.stdin.write(nextExpected.r + '\n');
          }

          if (expected.length > 0) {
            nextExpected = expected.shift();
            output = '';
          } else {
            nextExpected = null;
          }
        }
      });
    }

    child.on('exit', function(code, signal) {
      if (code === 0) {
        resolve(code);
      } else {
        reject(code);
      }
    });

    child.on('error', function(err) {
      reject(err);
    });
  });
}

function getTokenId(page) {
  page = page || 1;

  return new Promise(function(resolve, reject) {
    github.authorization.getAll({
      page: page,
      headers: useOTP ? { 'X-GitHub-OTP': readlineSync.question('Auth Code: ') } : {},
    }, function(err, res) {
      if (err) {
        reject(err);
        return;
      }

      for (var i = 0; i < res.length; i++) {
        if (res[i].note === 'test' && res[i].note_url === 'http://www.test.org') {
          resolve(res[i].id);
          return;
        }
      }

      resolve(getToken(++page));
    });
  });
}

function deleteAuthorization(tokenId) {
  return new Promise(function(resolve, reject) {
    github.authorization.delete({
      id: tokenId,
      headers: useOTP ? { 'X-GitHub-OTP': readlineSync.question('Auth Code: ') } : {},
    }, function(err) {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

function createAuthorization() {
  return new Promise(function(resolve, reject) {
    github.authorization.create({
      scopes: ['repo', 'public_repo', 'delete_repo'],
      note: 'test',
      note_url: 'http://www.test.org',
      headers: useOTP ? { 'X-GitHub-OTP': readlineSync.question('Auth Code: ') } : {},
    }, function(err, res) {
      if (err) {
        reject(err);
        return;
      }

      githubToken = res.token;
      githubTokenId = res.id;

      github.authenticate({
        type: 'oauth',
        token: githubToken,
      });

      resolve(res);
    });
  }).catch(function(err) {
    var error = JSON.parse(err.message);

    if (error.message === 'Must specify two-factor authentication OTP code.') {
      useOTP = true;
      return createAuthorization();
    }

    if (error.message === 'Validation Failed' && error.errors[0].code === 'already_exists') {
      return getTokenId().then(deleteAuthorization).then(createAuthorization);
    }

    throw err;
  });
}

describe('CLI interface, oghliner as a tool', function() {
  this.timeout(0);

  var oldWD = process.cwd();

  before(function() {
    github.authenticate({
      type: 'basic',
      username: username,
      password: password,
    });

    return createAuthorization();
  });

  beforeEach(function() {
    process.chdir(temp.mkdirSync('oghliner'));

    process.env.GH_TOKEN = username + ':' + githubToken;

    return deleteRepo()
    .catch(function() {
      // Ignore error if the repo doesn't exist.
    });
  });

  afterEach(function(done) {
    process.chdir(oldWD);

    delete process.env['GH_TOKEN'];
  });

  it('should work', function() {
    return createRepo()
    .then(spawn.bind(null, 'git', ['clone', 'https://' + username + ':' + githubToken + '@github.com/' + username + '/test_oghliner_live']))
    .then(process.chdir.bind(null, 'test_oghliner_live'))
    .then(spawn.bind(null, 'npm', ['install', path.dirname(__dirname)]))
    .then(function() {
      fse.mkdirSync('dist');
    })
    .then(fse.writeFileSync.bind(fse, 'dist/index.html', '<html></html>'))
    .then(spawn.bind(null, path.join('node_modules', '.bin', 'oghliner'), ['offline', 'dist']))
    .then(spawn.bind(null, path.join('node_modules', '.bin', 'oghliner'), ['integrate', 'dist']))
    .then(spawn.bind(null, path.join('node_modules', '.bin', 'oghliner'), ['deploy', 'dist']))
    .then(function() {
      return getBranch()
      .catch(getBranch)
      .catch(getBranch)
    })
    .then(spawn.bind(null, path.join('node_modules', '.bin', 'oghliner'), ['configure'], [
      {
        q: 'Username: ',
        r: username,
      },
      {
        q: 'Password: ',
        r: password,
      },
      {
        q: 'Auth Code: ',
        r: readlineSync.question,
      }
    ]))
    .then(function() {
      var travisYml = readYaml.sync('.travis.yml');
      expect(travisYml.language).to.equal('node_js');
      expect(travisYml.node_js).to.deep.equal(['0.12']);
      expect(travisYml.install).to.equal('npm install');
      expect(travisYml.script).to.equal('gulp');
      expect(travisYml).to.include.keys('env');
      expect(travisYml.env).to.include.keys('global');
      expect(travisYml.env.global).to.have.length(1);
      expect(travisYml.env.global[0]).to.have.keys('secure');
      expect(travisYml.after_success[0]).to.equal(
        'echo "travis_fold:end:after_success" && ' +
        '[ "${TRAVIS_PULL_REQUEST}" = "false" ] && [ "${TRAVIS_BRANCH}" = "master" ] && ' +
        'echo "Deploying…" && gulp deploy'
      );
    })
    .then(function() {
      fse.readdirSync('.').forEach(function(file) {
        if (file === '.git') {
          return;
        }

        fse.removeSync(file);
      });
    })
    .then(spawn.bind(null, 'git', ['checkout', '-b', 'gh-pages']))
    .then(spawn.bind(null, 'git', ['pull', 'origin', 'gh-pages']))
    .then(function() {
      assert.doesNotThrow(fse.statSync.bind(fse, 'offline-manager.js'));
      assert.doesNotThrow(fse.statSync.bind(fse, 'offline-worker.js'));
    });
  });
});