'use strict';
module.exports=function decode(form){return {chat_id:form.get('chat_id'),text:form.get('caption'),protect_content:form.get('protect_content')==='true',document:form.get('document')};};
