/**
 * Usage:
 *
 * node ./upload.js
 *
 * - Uses package.json config to know about data sets.
 * - Expects output files to end with .out.txt
 * - Expects to find files ordered by creation time in .builds
 */

const path = require("path");
const _ = require("lodash");
const debug = require("debug")("upload");
const fs = require("fs");
const joi = require("joi");
const request = require("request-promise");

const { HASH_CODE_JUDGE_AUTH_TOKEN: authToken } = process.env;
if (authToken) {
  debug("token", shorten(authToken));
} else {
  console.error(
    "HASH_CODE_JUDGE_AUTH_TOKEN not defined. Set it with your auth token to the Judge system."
  );
  process.exit();
}

const createUrlUri =
  "https://hashcode-judge.appspot.com/api/judge/v1/upload/createUrl";
const submitUri = "https://hashcode-judge.appspot.com/api/judge/v1/submissions";
const authorizationHeader = { Authorization: `Bearer ${authToken}` };
const dataSets = _.range(4).reduce((dataSets, i) => {
  const name = process.env[`npm_package_config_input${i + 1}_name`];
  if (!name) return dataSets;
  debug(`found data set '${name}' in package.json`);
  return Object.assign(dataSets, {
    [name]: process.env[`npm_package_config_input${i + 1}_id`]
  });
}, {});

const solutionSchema = joi
  .object()
  .min(2)
  .keys(_.mapValues(dataSets, () => joi.string()))
  .keys({ sources: joi.string().required() });

function* submitSolution(solution) {
  solution = joi.attempt(
    solution,
    solutionSchema,
    "invalid solution parameters"
  );

  const blobKeys = yield _.mapValues(solution, upload);
  const solutionBlobKeys = _.omit(blobKeys, "sources");
  return yield _.mapValues(solutionBlobKeys, function(blobKey, dataSetName) {
    debug(`submitting data set ${dataSetName} (key: ${shorten(blobKey)}`);
    return submit(dataSets[dataSetName], blobKey, blobKeys.sources);
  });
}

function* upload(filePath) {
  const uploadUri = yield createUploadUri();
  debug(`uploading ${filePath} to ${shorten(uploadUri)}`);
  const formData = { file: fs.createReadStream(filePath) };
  const responseBody = yield request({
    method: "POST",
    uri: uploadUri,
    formData,
    json: true
  });
  const blobKey = responseBody.file[0];
  debug(`uploaded ${filePath} (key: ${shorten(blobKey)})`);
  return blobKey;
}

function* createUploadUri() {
  const response = yield request({
    method: "GET",
    uri: createUrlUri,
    headers: authorizationHeader,
    json: true
  });
  return response.value;
}

function* submit(dataSet, submissionBlobKey, sourcesBlobKey) {
  const queryParameters = { dataSet, submissionBlobKey, sourcesBlobKey };
  return yield request({
    method: "POST",
    uri: submitUri,
    headers: authorizationHeader,
    qs: queryParameters
  });
}

function shorten(str) {
  return (
    _(str)
      .slice(0, 20)
      .join("") + "..."
  );
}

if (module === require.main) {
  if (_.isEmpty(dataSets)) {
    console.log(
      "data set ids not initialized! open upload.js and fill the dataSets value"
    );
    process.exit(1);
  }
  const co = require("co");
  const explode = err =>
    process.nextTick(() => {
      throw err;
    });
  const solution = Object.assign(
    _.mapValues(dataSets, (id, name) => `${name}.out.txt`),
    {
      sources: path.join(
        __dirname,
        ".builds",
        _.last(fs.readdirSync(path.join(__dirname, ".builds")).sort())
      )
    }
  );
  debug("files to upload", solution);
  co(submitSolution(solution)).catch(explode);
}
