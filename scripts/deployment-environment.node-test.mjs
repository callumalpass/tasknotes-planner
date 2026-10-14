import assert from "node:assert/strict";
import {test} from "node:test";
import {plannerDeploymentFor} from "./deployment-environment.mjs";
test("Planner LAB is an explicit fixed target; prior staging default is unchanged",()=>{
  assert.deepEqual(plannerDeploymentFor({MDBASE_ENV:"lab"}),{appOrigin:"https://lab.tasknotes-planner.pages.dev",connectOrigin:"https://connect-lab.mdbase.dev",loopbackOrigin:"http://127.0.0.1:28487",branch:"lab"});
  assert.equal(plannerDeploymentFor({}).branch,"staging");assert.equal(plannerDeploymentFor({MDBASE_ENV:"staging"}).connectOrigin,"https://connect-staging.mdbase.dev");
  for(const MDBASE_ENV of ["production","unknown",""])assert.throws(()=>plannerDeploymentFor({MDBASE_ENV}));
});
