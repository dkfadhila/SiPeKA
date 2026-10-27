'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path');
test('Hermes skills patch supports both signatures, retains listing order, is idempotent and refuses unrelated source',()=>{
 const p=spawnSync('python',['-c',String.raw`
import importlib.util,asyncio
s=importlib.util.spec_from_file_location('patch','scripts/patch-widya-hermes-skills.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
source='class Api:\n    async def _handle_skills(self):\n'+m.OLD+'\n            return skills\n'
patched,changed=m.patch_source(source);assert changed
assert m.patch_source(patched)==(patched,False)
for version in ['old','new']:
    calls=[]
    if version=='old':
        def catalog(*,skip_disabled=False):
            calls.append({'skip_disabled':skip_disabled});return [{'name':'z'},{'name':'a'}]
    else:
        def catalog(*,skip_disabled=False,include_editorial=False):
            calls.append({'skip_disabled':skip_disabled,'include_editorial':include_editorial});return [{'name':'z'},{'name':'a'}]
    scope={'_find_all_skills':catalog,'_sort_skills':lambda xs:sorted(xs,key=lambda x:x['name'])}
    exec(patched,scope)
    result=asyncio.run(scope['Api']()._handle_skills())
    assert [x['name'] for x in result]==['a','z']
    assert calls==[{'skip_disabled':False}] if version=='old' else calls==[{'skip_disabled':False,'include_editorial':True}]
for bad in ['class Other: pass',source.replace('include_editorial=True','unknown=True'),source+source]:
    try:m.patch_source(bad)
    except ValueError:pass
    else:raise AssertionError('accepted unexpected source')
assert m.signature('def _find_all_skills(*,skip_disabled=False): pass')==['skip_disabled']
print('signature compatibility, idempotence, source guard and output order verified')
`],{cwd:path.resolve(__dirname,'..'),encoding:'utf8'});
 assert.equal(p.status,0,p.stdout+p.stderr);assert.match(p.stdout,/verified/);
});
