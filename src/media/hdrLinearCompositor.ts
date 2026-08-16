import type { ClipTransform, ColorAdjustment, VisualEffects } from '../editor/types'
import { hasCustomColorCurves, normalizeColorCurve } from '../editor/colorCurves'
import { defaultColorAdjustment } from '../editor/effects'
import type { HdrFrameData } from './hdr10'
import type { RawHdrFrame } from './hdrRawTransform'
import { HLG_SDR_WHITE_SCENE, SDR_REFERENCE_WHITE_NITS } from './colorConformance'

type Transfer = 'pq' | 'hlg'

const hdrBlendModes: Array<NonNullable<VisualEffects['blendMode']>> = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'hard-light', 'soft-light', 'difference', 'exclusion', 'color-dodge', 'color-burn']

interface Resources {
  device: any
  usage: any
  textureUsage: any
  mapMode: any
  textures: [any, any]
  canvasTexture: any
  maskTexture: any
  clearPipeline: any
  rawBasePipeline: any
  rawPipeline: any
  adjustmentPipeline: any
  canvasPipeline: any
  outputPipeline: any
  clearParams: any
  rawBaseParams: any
  rawParams: any
  adjustmentParams: any
  curveBuffer: any
  nodeMetaBuffer: any
  nodeValueBuffer: any
  nodeCurveBuffer: any
  canvasParams: any
  outputParams: any
  rawInput?: any
  rawCapacity: number
  output: any
  readback: any
  outputByteLength: number
}

const transferFunctions = `
fn pq_inverse(value: f32) -> f32 { let m1=0.1593017578125;let m2=78.84375;let c1=0.8359375;let c2=18.8515625;let c3=18.6875;let p=pow(clamp(value,0.0,1.0),1.0/m2);return pow(max((p-c1)/max(c2-c3*p,0.000001),0.0),1.0/m1); }
fn pq_forward(value: f32) -> f32 { let m1=0.1593017578125;let m2=78.84375;let c1=0.8359375;let c2=18.8515625;let c3=18.6875;let p=pow(clamp(value,0.0,1.0),m1);return pow((c1+c2*p)/(1.0+c3*p),m2); }
fn hlg_inverse(value: f32) -> f32 { let a=0.17883277;let b=0.28466892;let c=0.55991073;if(value<=0.5){return value*value/3.0;}return (exp((value-c)/a)+b)/12.0; }
fn hlg_forward(value: f32) -> f32 { let a=0.17883277;let b=0.28466892;let c=0.55991073;if(value<=0.0833333333){return sqrt(3.0*max(value,0.0));}return a*log(12.0*value-b)+c; }
`

const advancedColorFunctions = `
fn curve_value(offset:u32,value:f32)->f32{let position=clamp(value,0.0,1.0)*255.0;let first=u32(floor(position));let second=min(255u,first+1u);return mix(curves[offset+first],curves[offset+second],fract(position));}
fn apply_curves(value:vec3<f32>)->vec3<f32>{if(params.curvesEnabled<0.5){return value;}let channel=vec3<f32>(curve_value(256u,value.r),curve_value(512u,value.g),curve_value(768u,value.b));return vec3<f32>(curve_value(0u,channel.r),curve_value(0u,channel.g),curve_value(0u,channel.b));}
fn rgb_to_hsl(value:vec3<f32>)->vec3<f32>{let maximum=max(max(value.r,value.g),value.b);let minimum=min(min(value.r,value.g),value.b);let delta=maximum-minimum;let light=(maximum+minimum)*0.5;if(delta<=0.000001){return vec3<f32>(0.0,0.0,light);}let saturation=delta/max(0.000001,1.0-abs(2.0*light-1.0));var hue:f32;if(maximum==value.r){hue=(value.g-value.b)/delta;}else if(maximum==value.g){hue=(value.b-value.r)/delta+2.0;}else{hue=(value.r-value.g)/delta+4.0;}return vec3<f32>(fract(hue/6.0+1.0),clamp(saturation,0.0,1.0),clamp(light,0.0,1.0));}
fn hsl_to_rgb(value:vec3<f32>)->vec3<f32>{let hue=fract(value.x+1.0);let saturation=clamp(value.y,0.0,1.0);let light=clamp(value.z,0.0,1.0);let chroma=(1.0-abs(2.0*light-1.0))*saturation;let sector=hue*6.0;let sectorMod2=sector-floor(sector*0.5)*2.0;let secondary=chroma*(1.0-abs(sectorMod2-1.0));var rgb:vec3<f32>;if(sector<1.0){rgb=vec3<f32>(chroma,secondary,0.0);}else if(sector<2.0){rgb=vec3<f32>(secondary,chroma,0.0);}else if(sector<3.0){rgb=vec3<f32>(0.0,chroma,secondary);}else if(sector<4.0){rgb=vec3<f32>(0.0,secondary,chroma);}else if(sector<5.0){rgb=vec3<f32>(secondary,0.0,chroma);}else{rgb=vec3<f32>(chroma,0.0,secondary);}return rgb+vec3<f32>(light-chroma*0.5);}
fn band_weight(value:f32,minimum:f32,maximum:f32,softness:f32)->f32{let low=min(minimum,maximum);let high=max(minimum,maximum);let safe=max(0.00001,softness);let lower=smoothstep(low-safe,low,value);let upper=1.0-smoothstep(high,high+safe,value);return lower*upper;}
fn apply_qualifier(value:vec3<f32>)->vec3<f32>{if(params.qualifierEnabled<0.5){return value;}let hsl=rgb_to_hsl(clamp(value,vec3<f32>(0.0),vec3<f32>(1.0)));let hueDistance=abs(fract(hsl.x-params.qualifierHue+0.5)-0.5);let hueSoftness=max(0.00001,params.qualifierSoftness*0.25);let hueWeight=1.0-smoothstep(params.qualifierHueRange,params.qualifierHueRange+hueSoftness,hueDistance);let weight=hueWeight*band_weight(hsl.y,params.qualifierSaturationMin,params.qualifierSaturationMax,params.qualifierSoftness*0.35)*band_weight(hsl.z,params.qualifierLuminanceMin,params.qualifierLuminanceMax,params.qualifierSoftness*0.35);let corrected=hsl_to_rgb(vec3<f32>(hsl.x+params.qualifierHueShift,hsl.y*max(0.0,1.0+params.qualifierSaturation),hsl.z*exp2(params.qualifierExposure)));return mix(value,corrected,weight);}
`

const colorNodeFunctions = `
fn apply_look(value:vec3<f32>,kind:u32,amount:f32)->vec3<f32>{let mixAmount=clamp(amount,0.0,1.0);if(kind==0u||mixAmount<=0.0){return value;}let luma=dot(value,vec3<f32>(0.2627,0.678,0.0593));var looked=value;if(kind==1u){let contrasted=max((value-vec3<f32>(0.18))*(1.0+0.16*mixAmount)+vec3<f32>(0.18),vec3<f32>(0.0));let desaturated=mix(vec3<f32>(dot(contrasted,vec3<f32>(0.2627,0.678,0.0593))),contrasted,1.0-0.08*mixAmount);let sepia=vec3<f32>(dot(desaturated,vec3<f32>(0.393,0.769,0.189)),dot(desaturated,vec3<f32>(0.349,0.686,0.168)),dot(desaturated,vec3<f32>(0.272,0.534,0.131)));looked=mix(desaturated,sepia,0.08*mixAmount);}else if(kind==2u){let sepia=vec3<f32>(dot(value,vec3<f32>(0.393,0.769,0.189)),dot(value,vec3<f32>(0.349,0.686,0.168)),dot(value,vec3<f32>(0.272,0.534,0.131)));let warmed=mix(value,sepia,0.18*mixAmount);let warmLuma=dot(warmed,vec3<f32>(0.2627,0.678,0.0593));looked=mix(vec3<f32>(warmLuma),warmed,1.0+0.16*mixAmount);}else if(kind==3u){let rotated=max(rotate_hue(value,0.20943951*mixAmount),vec3<f32>(0.0));let coolLuma=dot(rotated,vec3<f32>(0.2627,0.678,0.0593));looked=mix(vec3<f32>(coolLuma),rotated,1.0+0.08*mixAmount);}else{looked=mix(value,vec3<f32>(luma),mixAmount);looked=max((looked-vec3<f32>(0.18))*(1.0+0.08*mixAmount)+vec3<f32>(0.18),vec3<f32>(0.0));}return max(looked,vec3<f32>(0.0));}
fn node_value(node:u32,offset:u32)->f32{return nodeValues[node*40u+offset];}
fn node_curve(node:u32,channel:u32,value:f32)->f32{let position=clamp(value,0.0,1.0)*255.0;let first=u32(floor(position));let second=min(255u,first+1u);let offset=node*1024u+channel*256u;return mix(nodeCurves[offset+first],nodeCurves[offset+second],fract(position));}
fn node_grade(value:vec3<f32>,node:u32)->vec3<f32>{var v=max(value*exp2(node_value(node,1u)),vec3<f32>(0.0));var l=dot(v,vec3<f32>(0.2627,0.678,0.0593));let sw=1.0-smoothstep(0.02,0.32,l);let mw=1.0-abs(clamp(l,0.0,1.0)*2.0-1.0);let hw=smoothstep(0.22,0.75,l);v*=max(0.0,1.0+node_value(node,7u)*sw*0.55+node_value(node,6u)*hw*0.55+node_value(node,14u)*sw*0.35+node_value(node,15u)*mw*0.35+node_value(node,16u)*hw*0.35);v=max((v-vec3<f32>(0.18))*(1.0+node_value(node,2u))+vec3<f32>(0.18),vec3<f32>(0.0));v*=vec3<f32>(1.0+node_value(node,4u)*0.12+node_value(node,5u)*0.025,1.0-node_value(node,5u)*0.08,1.0-node_value(node,4u)*0.12+node_value(node,5u)*0.025);v=max(rotate_hue(v,node_value(node,8u)),vec3<f32>(0.0));l=dot(v,vec3<f32>(0.2627,0.678,0.0593));let chroma=max(max(abs(v.r-l),abs(v.g-l)),abs(v.b-l));let sat=max(0.0,1.0+node_value(node,3u)+node_value(node,9u)*(1.0-clamp(chroma*4.0,0.0,1.0)));v=mix(vec3<f32>(l),v,sat);v=max(v+vec3<f32>(node_value(node,11u)*0.08),vec3<f32>(0.0));v=pow(v,vec3<f32>(1.0/max(0.1,1.0+node_value(node,12u))));v*=max(0.0,1.0+node_value(node,13u));l=dot(v,vec3<f32>(0.2627,0.678,0.0593));return max(mix(v,vec3<f32>(l),clamp(node_value(node,10u),0.0,1.0)*0.35),vec3<f32>(0.0));}
fn node_curves(value:vec3<f32>,node:u32)->vec3<f32>{let channel=vec3<f32>(node_curve(node,1u,value.r),node_curve(node,2u,value.g),node_curve(node,3u,value.b));return vec3<f32>(node_curve(node,0u,channel.r),node_curve(node,0u,channel.g),node_curve(node,0u,channel.b));}
  fn node_qualifier(value:vec3<f32>,node:u32)->vec3<f32>{if(node_value(node,17u)<0.5){return value;}let hsl=rgb_to_hsl(clamp(value,vec3<f32>(0.0),vec3<f32>(1.0)));let hueDistance=abs(fract(hsl.x-node_value(node,18u)+0.5)-0.5);let softness=max(0.00001,node_value(node,24u));let hueWeight=1.0-smoothstep(node_value(node,19u),node_value(node,19u)+softness*0.25,hueDistance);let weight=hueWeight*band_weight(hsl.y,node_value(node,20u),node_value(node,21u),softness*0.35)*band_weight(hsl.z,node_value(node,22u),node_value(node,23u),softness*0.35);let corrected=hsl_to_rgb(vec3<f32>(hsl.x+node_value(node,27u),hsl.y*max(0.0,1.0+node_value(node,26u)),hsl.z*exp2(node_value(node,25u))));return mix(value,corrected,weight);}
fn node_look(value:vec3<f32>,node:u32)->vec3<f32>{return apply_look(value,u32(node_value(node,28u)),node_value(node,29u));}
fn hable(value:vec3<f32>)->vec3<f32>{let a=0.15;let b=0.5;let c=0.1;let d=0.2;let e=0.02;let f=0.3;return ((value*(a*value+vec3<f32>(c*b))+vec3<f32>(d*e))/(value*(a*value+vec3<f32>(b))+vec3<f32>(d*f)))-vec3<f32>(e/f);}
fn node_tone(value:vec3<f32>,node:u32)->vec3<f32>{let method=u32(node_value(node,30u));let scale=max(1.0,node_value(node,31u))/max(1.0,node_value(node,32u));let v=max(value*scale,vec3<f32>(0.0));if(method==1u){return v/(vec3<f32>(1.0)+v);}if(method==2u){return select((v+vec3<f32>(0.18))/(v+vec3<f32>(0.78)),v,v<=vec3<f32>(0.3));}return hable(v)/max(hable(vec3<f32>(scale)),vec3<f32>(0.001));}
  fn apply_node_graph(value:vec3<f32>)->vec3<f32>{let count=min(16u,nodeMeta[0]);if(count==0u){return value;}var outputs:array<vec3<f32>,17>;outputs[0]=value;for(var node=0u;node<16u;node++){if(node>=count){break;}let base=4u+node*20u;let inputCount=max(1u,min(16u,nodeMeta[base+3u]));var input=outputs[min(16u,nodeMeta[base+4u])];for(var inputIndex=1u;inputIndex<16u;inputIndex++){if(inputIndex>=inputCount){break;}let next=outputs[min(16u,nodeMeta[base+4u+inputIndex])];let amount=1.0/f32(inputIndex+1u);let mode=nodeMeta[base+2u];if(mode==1u){input=mix(input,input+next,amount);}else if(mode==2u){input=mix(input,input*next,amount);}else if(mode==3u){input=mix(input,vec3<f32>(1.0)-(vec3<f32>(1.0)-input)*(vec3<f32>(1.0)-next),amount);}else{input=mix(input,next,amount);}}input=max(input,vec3<f32>(0.0));var processed=input;if(nodeMeta[base+1u]!=0u){let kind=nodeMeta[base];if(kind==0u){processed=node_grade(input,node);}else if(kind==1u){processed=node_curves(input,node);}else if(kind==2u){processed=node_qualifier(input,node);}else if(kind==3u){processed=node_look(node_grade(input,node),node);}else{processed=node_tone(input,node);}}outputs[node+1u]=mix(input,processed,clamp(node_value(node,0u),0.0,1.0));}return outputs[min(16u,nodeMeta[1])];}
`

const clearShader = `
struct Params { width:u32,height:u32 }
@group(0) @binding(0) var outputTexture:texture_storage_2d<rgba16float,write>;
@group(0) @binding(1) var<uniform> params:Params;
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3<u32>){if(id.x>=params.width||id.y>=params.height){return;}textureStore(outputTexture,vec2<i32>(id.xy),vec4<f32>(0.0,0.0,0.0,1.0));}
`

const rawBaseShader = `
${transferFunctions}
struct Params {
  outWidth:u32,outHeight:u32,srcWidth:u32,srcHeight:u32,
  yOffset:u32,yStride:u32,uOffset:u32,uStride:u32,
  vOffset:u32,vStride:u32,transferMode:u32,unused:u32,
  visibleX:u32,visibleY:u32,visibleWidth:u32,visibleHeight:u32,
  drawWidth:f32,drawHeight:f32,centerX:f32,centerY:f32,
  inverseScaleX:f32,inverseScaleY:f32,anchorX:f32,anchorY:f32,
  skewX:f32,skewY:f32,inverseSkewDet:f32,cosAngle:f32,
  sinAngle:f32,opacity:f32,padding0:f32,padding1:f32
}
@group(0) @binding(0) var<storage,read> source:array<u32>;
@group(0) @binding(1) var base:texture_2d<f32>;
@group(0) @binding(2) var outputTexture:texture_storage_2d<rgba16float,write>;
@group(0) @binding(3) var<uniform> params:Params;
fn read_u16(offset:u32)->f32{let word=source[offset/4u];let shift=(offset&2u)*8u;return f32((word>>shift)&65535u);}
fn plane(offset:u32,stride:u32,x:u32,y:u32)->f32{return read_u16(offset+y*stride+x*2u);}
fn sample_plane(offset:u32,stride:u32,width:u32,height:u32,p:vec2<f32>)->f32{let q=clamp(p,vec2<f32>(0.0),vec2<f32>(f32(width-1u),f32(height-1u)));let a=vec2<u32>(floor(q));let b=min(a+vec2<u32>(1u),vec2<u32>(width-1u,height-1u));let f=fract(q);return mix(mix(plane(offset,stride,a.x,a.y),plane(offset,stride,b.x,a.y),f.x),mix(plane(offset,stride,a.x,b.y),plane(offset,stride,b.x,b.y),f.x),f.y);}
fn source_rgb(p:vec2<f32>)->vec3<f32>{let y=(sample_plane(params.yOffset,params.yStride,params.srcWidth,params.srcHeight,p)-64.0)/876.0;let cp=p*0.5;let cb=(sample_plane(params.uOffset,params.uStride,(params.srcWidth+1u)/2u,(params.srcHeight+1u)/2u,cp)-512.0)/896.0;let cr=(sample_plane(params.vOffset,params.vStride,(params.srcWidth+1u)/2u,(params.srcHeight+1u)/2u,cp)-512.0)/896.0;return clamp(vec3<f32>(y+1.4746*cr,y-0.164553*cb-0.571353*cr,y+1.8814*cb),vec3<f32>(0.0),vec3<f32>(1.0));}
fn mapped_source(position:vec2<f32>)->vec2<f32>{let centered=position-vec2<f32>(params.centerX,params.centerY);let rotated=vec2<f32>(params.cosAngle*centered.x+params.sinAngle*centered.y,-params.sinAngle*centered.x+params.cosAngle*centered.y);let unskewed=vec2<f32>((rotated.x-params.skewX*rotated.y)*params.inverseSkewDet,(rotated.y-params.skewY*rotated.x)*params.inverseSkewDet);let local=vec2<f32>(unskewed.x*params.inverseScaleX+params.anchorX,unskewed.y*params.inverseScaleY+params.anchorY);if(local.x<0.0||local.y<0.0||local.x>=params.drawWidth||local.y>=params.drawHeight){return vec2<f32>(-1.0);}let uv=vec2<f32>(local.x/params.drawWidth,local.y/params.drawHeight);return vec2<f32>(f32(params.visibleX),f32(params.visibleY))+uv*vec2<f32>(f32(params.visibleWidth),f32(params.visibleHeight));}
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3<u32>){if(id.x>=params.outWidth||id.y>=params.outHeight){return;}let under=textureLoad(base,vec2<i32>(id.xy),0);let mapped=mapped_source(vec2<f32>(id.xy)+vec2<f32>(0.5));if(mapped.x<0.0){textureStore(outputTexture,vec2<i32>(id.xy),under);return;}let encoded=source_rgb(mapped);let linear=select(vec3<f32>(hlg_inverse(encoded.r),hlg_inverse(encoded.g),hlg_inverse(encoded.b)),vec3<f32>(pq_inverse(encoded.r),pq_inverse(encoded.g),pq_inverse(encoded.b)),params.transferMode==0u);textureStore(outputTexture,vec2<i32>(id.xy),vec4<f32>(mix(under.rgb,linear,params.opacity),1.0));}
`

const rawShader = `
${transferFunctions}
struct Params {
  outWidth:u32,outHeight:u32,srcWidth:u32,srcHeight:u32,
  yOffset:u32,yStride:u32,uOffset:u32,uStride:u32,
  vOffset:u32,vStride:u32,transferMode:u32,unused:u32,
  visibleX:u32,visibleY:u32,visibleWidth:u32,visibleHeight:u32,
  drawWidth:f32,drawHeight:f32,centerX:f32,centerY:f32,
  inverseScaleX:f32,inverseScaleY:f32,anchorX:f32,anchorY:f32,
  skewX:f32,skewY:f32,inverseSkewDet:f32,cosAngle:f32,
  sinAngle:f32,opacity:f32,
  exposure:f32,contrast:f32,saturation:f32,temperature:f32,
  tint:f32,highlights:f32,shadows:f32,hue:f32,
  vibrance:f32,fade:f32,lift:f32,gamma:f32,
  gain:f32,curveShadows:f32,curveMidtones:f32,curveHighlights:f32,
  cropTop:f32,cropRight:f32,cropBottom:f32,cropLeft:f32,
  vignette:f32,blurRadius:f32,lutKind:f32,lutIntensity:f32,
  keyR:f32,keyG:f32,keyB:f32,keyTolerance:f32,
  keySoftness:f32,keySpill:f32,reserved3:f32,reserved4:f32,
  qualifierEnabled:f32,qualifierHue:f32,qualifierHueRange:f32,qualifierSaturationMin:f32,
  qualifierSaturationMax:f32,qualifierLuminanceMin:f32,qualifierLuminanceMax:f32,qualifierSoftness:f32,
  qualifierExposure:f32,qualifierSaturation:f32,qualifierHueShift:f32,curvesEnabled:f32,
  shadowOpacity:f32,shadowBlur:f32,shadowX:f32,shadowY:f32,
  faceEnabled:f32,faceX:f32,faceY:f32,faceSize:f32
}
@group(0) @binding(0) var<storage,read> source:array<u32>;
@group(0) @binding(1) var base:texture_2d<f32>;
@group(0) @binding(2) var outputTexture:texture_storage_2d<rgba16float,write>;
@group(0) @binding(3) var<uniform> params:Params;
@group(0) @binding(4) var maskTexture:texture_2d<f32>;
@group(0) @binding(5) var<storage,read> curves:array<f32>;
@group(0) @binding(6) var<storage,read> nodeMeta:array<u32>;
@group(0) @binding(7) var<storage,read> nodeValues:array<f32>;
@group(0) @binding(8) var<storage,read> nodeCurves:array<f32>;
${advancedColorFunctions}
${colorNodeFunctions}
fn read_u16(offset:u32)->f32{let word=source[offset/4u];let shift=(offset&2u)*8u;return f32((word>>shift)&65535u);}
fn plane(offset:u32,stride:u32,x:u32,y:u32)->f32{return read_u16(offset+y*stride+x*2u);}
fn sample_plane(offset:u32,stride:u32,width:u32,height:u32,p:vec2<f32>)->f32{let q=clamp(p,vec2<f32>(0.0),vec2<f32>(f32(width-1u),f32(height-1u)));let a=vec2<u32>(floor(q));let b=min(a+vec2<u32>(1u),vec2<u32>(width-1u,height-1u));let f=fract(q);return mix(mix(plane(offset,stride,a.x,a.y),plane(offset,stride,b.x,a.y),f.x),mix(plane(offset,stride,a.x,b.y),plane(offset,stride,b.x,b.y),f.x),f.y);}
fn source_rgb(p:vec2<f32>)->vec3<f32>{let y=(sample_plane(params.yOffset,params.yStride,params.srcWidth,params.srcHeight,p)-64.0)/876.0;let cp=p*0.5;let cb=(sample_plane(params.uOffset,params.uStride,(params.srcWidth+1u)/2u,(params.srcHeight+1u)/2u,cp)-512.0)/896.0;let cr=(sample_plane(params.vOffset,params.vStride,(params.srcWidth+1u)/2u,(params.srcHeight+1u)/2u,cp)-512.0)/896.0;return clamp(vec3<f32>(y+1.4746*cr,y-0.164553*cb-0.571353*cr,y+1.8814*cb),vec3<f32>(0.0),vec3<f32>(1.0));}
fn blurred_source(p:vec2<f32>)->vec3<f32>{if(params.blurRadius<=0.0){return source_rgb(p);}let inverseScale=(abs(params.inverseScaleX)+abs(params.inverseScaleY))*0.5;let radius=min(64.0,params.blurRadius)*f32(params.visibleWidth)/max(1.0,params.drawWidth)*inverseScale;let diagonal=max(0.5,radius*0.7071);return (source_rgb(p)*4.0+source_rgb(p+vec2<f32>(radius,0.0))+source_rgb(p+vec2<f32>(-radius,0.0))+source_rgb(p+vec2<f32>(0.0,radius))+source_rgb(p+vec2<f32>(0.0,-radius))+source_rgb(p+vec2<f32>(diagonal,diagonal))*0.5+source_rgb(p+vec2<f32>(-diagonal,diagonal))*0.5+source_rgb(p+vec2<f32>(diagonal,-diagonal))*0.5+source_rgb(p+vec2<f32>(-diagonal,-diagonal))*0.5)/10.0;}
fn rotate_hue(value:vec3<f32>,angle:f32)->vec3<f32>{let axis=normalize(vec3<f32>(1.0));return value*cos(angle)+cross(axis,value)*sin(angle)+axis*dot(axis,value)*(1.0-cos(angle));}
fn grade(value:vec3<f32>)->vec3<f32>{var v=max(value*exp2(params.exposure),vec3<f32>(0.0));var l=dot(v,vec3<f32>(0.2627,0.678,0.0593));let sw=1.0-smoothstep(0.02,0.32,l);let mw=1.0-abs(clamp(l,0.0,1.0)*2.0-1.0);let hw=smoothstep(0.22,0.75,l);v*=max(0.0,1.0+params.shadows*sw*0.55+params.highlights*hw*0.55+params.curveShadows*sw*0.35+params.curveMidtones*mw*0.35+params.curveHighlights*hw*0.35);v=max((v-vec3<f32>(0.18))*(1.0+params.contrast)+vec3<f32>(0.18),vec3<f32>(0.0));v*=vec3<f32>(1.0+params.temperature*0.12+params.tint*0.025,1.0-params.tint*0.08,1.0-params.temperature*0.12+params.tint*0.025);v=max(rotate_hue(v,params.hue),vec3<f32>(0.0));l=dot(v,vec3<f32>(0.2627,0.678,0.0593));let chroma=max(max(abs(v.r-l),abs(v.g-l)),abs(v.b-l));let sat=max(0.0,1.0+params.saturation+params.vibrance*(1.0-clamp(chroma*4.0,0.0,1.0)));v=mix(vec3<f32>(l),v,sat);v=max(v+vec3<f32>(params.lift*0.08),vec3<f32>(0.0));v=pow(v,vec3<f32>(1.0/max(0.1,1.0+params.gamma)));v*=max(0.0,1.0+params.gain);l=dot(v,vec3<f32>(0.2627,0.678,0.0593));return max(mix(v,vec3<f32>(l),clamp(params.fade,0.0,1.0)*0.35),vec3<f32>(0.0));}
fn mapped_source(position:vec2<f32>)->vec4<f32>{let centered=position-vec2<f32>(params.centerX,params.centerY);let rotated=vec2<f32>(params.cosAngle*centered.x+params.sinAngle*centered.y,-params.sinAngle*centered.x+params.cosAngle*centered.y);let unskewed=vec2<f32>((rotated.x-params.skewX*rotated.y)*params.inverseSkewDet,(rotated.y-params.skewY*rotated.x)*params.inverseSkewDet);let local=vec2<f32>(unskewed.x*params.inverseScaleX+params.anchorX,unskewed.y*params.inverseScaleY+params.anchorY);if(local.x<0.0||local.y<0.0||local.x>=params.drawWidth||local.y>=params.drawHeight){return vec4<f32>(-1.0);}let uv=vec2<f32>(local.x/params.drawWidth,local.y/params.drawHeight);if(uv.x<params.cropLeft||uv.x>1.0-params.cropRight||uv.y<params.cropTop||uv.y>1.0-params.cropBottom){return vec4<f32>(-1.0);}let p=vec2<f32>(f32(params.visibleX),f32(params.visibleY))+uv*vec2<f32>(f32(params.visibleWidth),f32(params.visibleHeight));return vec4<f32>(p,uv);}
fn mask_alpha(position:vec2<f32>)->f32{if((params.unused&256u)==0u){return 1.0;}if(position.x<0.0||position.y<0.0||position.x>=f32(params.outWidth)||position.y>=f32(params.outHeight)){return 0.0;}return textureLoad(maskTexture,vec2<i32>(floor(position)),0).a;}
fn chroma_alpha(rgb:vec3<f32>)->f32{if((params.unused&512u)==0u){return 1.0;}let d=distance(rgb,vec3<f32>(params.keyR,params.keyG,params.keyB));return smoothstep(params.keyTolerance,params.keyTolerance+max(0.005,params.keySoftness),d);}
fn source_alpha(position:vec2<f32>)->f32{let mapped=mapped_source(position);if(mapped.x<0.0){return 0.0;}return mask_alpha(position)*chroma_alpha(source_rgb(mapped.xy));}
fn mosaic_position(position:vec2<f32>)->vec2<f32>{if(params.faceEnabled<0.5){return position;}let visibleSize=vec2<f32>(f32(params.visibleWidth),f32(params.visibleHeight));let size=max(2.0,min(visibleSize.x,visibleSize.y)*params.faceSize);let center=vec2<f32>(f32(params.visibleX),f32(params.visibleY))+vec2<f32>(params.faceX,params.faceY)*visibleSize;let origin=center-vec2<f32>(size*0.5);if(position.x<origin.x||position.y<origin.y||position.x>=origin.x+size||position.y>=origin.y+size){return position;}let cell=max(1.0,size/16.0);return origin+(floor((position-origin)/cell)+vec2<f32>(0.5))*cell;}
fn source_layer(position:vec2<u32>)->vec4<f32>{let screen=vec2<f32>(position)+vec2<f32>(0.5);let mapped=mapped_source(screen);if(mapped.x<0.0){return vec4<f32>(0.0);}var rgb=blurred_source(mosaic_position(mapped.xy));let keyAlpha=chroma_alpha(rgb);if((params.unused&512u)!=0u){let l=dot(rgb,vec3<f32>(0.2627,0.678,0.0593));rgb=mix(rgb,vec3<f32>(l),params.keySpill*(1.0-keyAlpha));}let linear=select(vec3<f32>(hlg_inverse(rgb.r),hlg_inverse(rgb.g),hlg_inverse(rgb.b)),vec3<f32>(pq_inverse(rgb.r),pq_inverse(rgb.g),pq_inverse(rgb.b)),params.transferMode==0u);let treated=apply_node_graph(apply_qualifier(apply_curves(apply_look(grade(linear),u32(params.lutKind),params.lutIntensity))));let edge=smoothstep(0.28,0.72,distance(mapped.zw,vec2<f32>(0.5)));return vec4<f32>(treated*(1.0-edge*params.vignette*0.85),mask_alpha(screen)*keyAlpha);}
fn shadow_alpha(position:vec2<u32>)->f32{if(params.shadowOpacity<=0.0){return 0.0;}let center=vec2<f32>(position)+vec2<f32>(0.5)-vec2<f32>(params.shadowX,params.shadowY);let radius=clamp(params.shadowBlur,0.0,64.0);if(radius<=0.0){return source_alpha(center)*params.shadowOpacity;}let diagonal=max(0.5,radius*0.7071);let alpha=(source_alpha(center)*4.0+source_alpha(center+vec2<f32>(radius,0.0))+source_alpha(center+vec2<f32>(-radius,0.0))+source_alpha(center+vec2<f32>(0.0,radius))+source_alpha(center+vec2<f32>(0.0,-radius))+source_alpha(center+vec2<f32>(diagonal,diagonal))*0.5+source_alpha(center+vec2<f32>(-diagonal,diagonal))*0.5+source_alpha(center+vec2<f32>(diagonal,-diagonal))*0.5+source_alpha(center+vec2<f32>(-diagonal,-diagonal))*0.5)/10.0;return alpha*params.shadowOpacity;}
fn layer(position:vec2<u32>)->vec4<f32>{let sourceLayer=source_layer(position);let shadow=shadow_alpha(position);let groupAlpha=sourceLayer.a+shadow*(1.0-sourceLayer.a);let premultiplied=sourceLayer.rgb*sourceLayer.a;let straight=select(vec3<f32>(0.0),premultiplied/max(groupAlpha,0.000001),groupAlpha>0.000001);return vec4<f32>(straight,groupAlpha*params.opacity);}
fn blend_color(under:vec3<f32>,over:vec3<f32>)->vec3<f32>{let mode=params.unused&255u;if(mode==1u){return under*over;}if(mode==2u){return vec3<f32>(1.0)-(vec3<f32>(1.0)-under)*(vec3<f32>(1.0)-over);}if(mode==3u){return select(2.0*under*over,vec3<f32>(1.0)-2.0*(vec3<f32>(1.0)-under)*(vec3<f32>(1.0)-over),under>vec3<f32>(0.5));}if(mode==4u){return min(under,over);}if(mode==5u){return max(under,over);}if(mode==6u){return select(2.0*under*over,vec3<f32>(1.0)-2.0*(vec3<f32>(1.0)-under)*(vec3<f32>(1.0)-over),over>vec3<f32>(0.5));}if(mode==7u){let low=under-(vec3<f32>(1.0)-2.0*over)*under*(vec3<f32>(1.0)-under);let high=under+(2.0*over-vec3<f32>(1.0))*(sqrt(max(under,vec3<f32>(0.0)))-under);return select(low,high,over>vec3<f32>(0.5));}if(mode==8u){return abs(under-over);}if(mode==9u){return under+over-2.0*under*over;}if(mode==10u){return min(vec3<f32>(1.0),under/max(vec3<f32>(0.000001),vec3<f32>(1.0)-over));}if(mode==11u){return vec3<f32>(1.0)-min(vec3<f32>(1.0),(vec3<f32>(1.0)-under)/max(vec3<f32>(0.000001),over));}return over;}
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3<u32>){if(id.x>=params.outWidth||id.y>=params.outHeight){return;}let under=textureLoad(base,vec2<i32>(id.xy),0);let over=layer(id.xy);let blended=max(blend_color(under.rgb,over.rgb),vec3<f32>(0.0));textureStore(outputTexture,vec2<i32>(id.xy),vec4<f32>(mix(under.rgb,blended,over.a),1.0));}
`

const canvasShader = `
struct Params { width:u32,height:u32,transferMode:u32,unused:u32 }
@group(0) @binding(0) var overlay:texture_2d<f32>;
@group(0) @binding(1) var base:texture_2d<f32>;
@group(0) @binding(2) var outputTexture:texture_storage_2d<rgba16float,write>;
@group(0) @binding(3) var<uniform> params:Params;
fn srgb(value:f32)->f32{return select(value/12.92,pow((value+0.055)/1.055,2.4),value>0.04045);}
fn blend_color(under:vec3<f32>,over:vec3<f32>)->vec3<f32>{let mode=params.unused;if(mode==1u){return under*over;}if(mode==2u){return vec3<f32>(1.0)-(vec3<f32>(1.0)-under)*(vec3<f32>(1.0)-over);}if(mode==3u){return select(2.0*under*over,vec3<f32>(1.0)-2.0*(vec3<f32>(1.0)-under)*(vec3<f32>(1.0)-over),under>vec3<f32>(0.5));}if(mode==4u){return min(under,over);}if(mode==5u){return max(under,over);}if(mode==6u){return select(2.0*under*over,vec3<f32>(1.0)-2.0*(vec3<f32>(1.0)-under)*(vec3<f32>(1.0)-over),over>vec3<f32>(0.5));}if(mode==7u){let low=under-(vec3<f32>(1.0)-2.0*over)*under*(vec3<f32>(1.0)-under);let high=under+(2.0*over-vec3<f32>(1.0))*(sqrt(max(under,vec3<f32>(0.0)))-under);return select(low,high,over>vec3<f32>(0.5));}if(mode==8u){return abs(under-over);}if(mode==9u){return under+over-2.0*under*over;}if(mode==10u){return min(vec3<f32>(1.0),under/max(vec3<f32>(0.000001),vec3<f32>(1.0)-over));}if(mode==11u){return vec3<f32>(1.0)-min(vec3<f32>(1.0),(vec3<f32>(1.0)-under)/max(vec3<f32>(0.000001),over));}return over;}
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3<u32>){if(id.x>=params.width||id.y>=params.height){return;}let pixel=textureLoad(overlay,vec2<i32>(id.xy),0);let rgb709=vec3<f32>(srgb(pixel.r),srgb(pixel.g),srgb(pixel.b));let rgb2020=max(vec3<f32>(0.0),vec3<f32>(dot(rgb709,vec3<f32>(0.627404,0.329282,0.0433136)),dot(rgb709,vec3<f32>(0.069097,0.91954,0.0113612)),dot(rgb709,vec3<f32>(0.0163916,0.0880132,0.895595))));let linear=rgb2020*select(${HLG_SDR_WHITE_SCENE.toFixed(9)},${(SDR_REFERENCE_WHITE_NITS / 10_000).toFixed(7)},params.transferMode==0u);let under=textureLoad(base,vec2<i32>(id.xy),0);let blended=max(blend_color(under.rgb,linear),vec3<f32>(0.0));textureStore(outputTexture,vec2<i32>(id.xy),vec4<f32>(mix(under.rgb,blended,pixel.a),1.0));}
`

const adjustmentShader = `
struct Params {
  width:u32,height:u32,lutKind:u32,unused1:u32,
  exposure:f32,contrast:f32,saturation:f32,temperature:f32,
  tint:f32,highlights:f32,shadows:f32,hue:f32,
  vibrance:f32,fade:f32,lift:f32,gamma:f32,
  gain:f32,curveShadows:f32,curveMidtones:f32,curveHighlights:f32,
  vignette:f32,opacity:f32,blurRadius:f32,lutIntensity:f32,
  qualifierEnabled:f32,qualifierHue:f32,qualifierHueRange:f32,qualifierSaturationMin:f32,
  qualifierSaturationMax:f32,qualifierLuminanceMin:f32,qualifierLuminanceMax:f32,qualifierSoftness:f32,
  qualifierExposure:f32,qualifierSaturation:f32,qualifierHueShift:f32,curvesEnabled:f32
}
@group(0) @binding(0) var base:texture_2d<f32>;
@group(0) @binding(1) var outputTexture:texture_storage_2d<rgba16float,write>;
@group(0) @binding(2) var<uniform> params:Params;
@group(0) @binding(3) var<storage,read> curves:array<f32>;
@group(0) @binding(4) var<storage,read> nodeMeta:array<u32>;
@group(0) @binding(5) var<storage,read> nodeValues:array<f32>;
@group(0) @binding(6) var<storage,read> nodeCurves:array<f32>;
${advancedColorFunctions}
${colorNodeFunctions}
fn rotate_hue(value:vec3<f32>,angle:f32)->vec3<f32>{let axis=normalize(vec3<f32>(1.0));return value*cos(angle)+cross(axis,value)*sin(angle)+axis*dot(axis,value)*(1.0-cos(angle));}
fn grade(value:vec3<f32>)->vec3<f32>{var v=max(value*exp2(params.exposure),vec3<f32>(0.0));var l=dot(v,vec3<f32>(0.2627,0.678,0.0593));let sw=1.0-smoothstep(0.02,0.32,l);let mw=1.0-abs(clamp(l,0.0,1.0)*2.0-1.0);let hw=smoothstep(0.22,0.75,l);v*=max(0.0,1.0+params.shadows*sw*0.55+params.highlights*hw*0.55+params.curveShadows*sw*0.35+params.curveMidtones*mw*0.35+params.curveHighlights*hw*0.35);v=max((v-vec3<f32>(0.18))*(1.0+params.contrast)+vec3<f32>(0.18),vec3<f32>(0.0));v*=vec3<f32>(1.0+params.temperature*0.12+params.tint*0.025,1.0-params.tint*0.08,1.0-params.temperature*0.12+params.tint*0.025);v=max(rotate_hue(v,params.hue),vec3<f32>(0.0));l=dot(v,vec3<f32>(0.2627,0.678,0.0593));let chroma=max(max(abs(v.r-l),abs(v.g-l)),abs(v.b-l));let sat=max(0.0,1.0+params.saturation+params.vibrance*(1.0-clamp(chroma*4.0,0.0,1.0)));v=mix(vec3<f32>(l),v,sat);v=max(v+vec3<f32>(params.lift*0.08),vec3<f32>(0.0));v=pow(v,vec3<f32>(1.0/max(0.1,1.0+params.gamma)));v*=max(0.0,1.0+params.gain);l=dot(v,vec3<f32>(0.2627,0.678,0.0593));return max(mix(v,vec3<f32>(l),clamp(params.fade,0.0,1.0)*0.35),vec3<f32>(0.0));}
fn read_base(position:vec2<i32>)->vec3<f32>{let bounded=clamp(position,vec2<i32>(0),vec2<i32>(i32(params.width)-1,i32(params.height)-1));return textureLoad(base,bounded,0).rgb;}
fn blurred(position:vec2<i32>)->vec3<f32>{let radius=i32(round(clamp(params.blurRadius,0.0,64.0)));if(radius<=0){return read_base(position);}let diagonal=max(1,radius*7/10);return (read_base(position)*4.0+read_base(position+vec2<i32>(radius,0))+read_base(position+vec2<i32>(-radius,0))+read_base(position+vec2<i32>(0,radius))+read_base(position+vec2<i32>(0,-radius))+read_base(position+vec2<i32>(diagonal,diagonal))*0.5+read_base(position+vec2<i32>(-diagonal,diagonal))*0.5+read_base(position+vec2<i32>(diagonal,-diagonal))*0.5+read_base(position+vec2<i32>(-diagonal,-diagonal))*0.5)/10.0;}
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3<u32>){if(id.x>=params.width||id.y>=params.height){return;}let position=vec2<i32>(id.xy);let original=textureLoad(base,position,0);let uv=(vec2<f32>(id.xy)+vec2<f32>(0.5))/vec2<f32>(f32(params.width),f32(params.height));let edge=smoothstep(0.28,0.72,distance(uv,vec2<f32>(0.5)));let adjusted=apply_node_graph(apply_qualifier(apply_curves(apply_look(grade(blurred(position)),params.lutKind,params.lutIntensity))))*(1.0-edge*params.vignette*0.85);textureStore(outputTexture,position,vec4<f32>(mix(original.rgb,adjusted,clamp(params.opacity,0.0,1.0)),1.0));}
`

const outputShader = `
${transferFunctions}
struct Params { width:u32,height:u32,transferMode:u32,yPacks:u32,uvPacks:u32 }
@group(0) @binding(0) var frame:texture_2d<f32>;
@group(0) @binding(1) var<storage,read_write> packed:array<u32>;
@group(0) @binding(2) var<uniform> params:Params;
fn encoded(p:vec2<u32>)->vec3<f32>{let v=max(textureLoad(frame,vec2<i32>(p),0).rgb,vec3<f32>(0.0));return select(vec3<f32>(hlg_forward(v.r),hlg_forward(v.g),hlg_forward(v.b)),vec3<f32>(pq_forward(v.r),pq_forward(v.g),pq_forward(v.b)),params.transferMode==0u);}
fn yuv(p:vec2<u32>)->vec3<f32>{let rgb=encoded(p);let y=dot(rgb,vec3<f32>(0.2627,0.678,0.0593));return vec3<f32>(y,(rgb.b-y)/1.8814,(rgb.r-y)/1.4746);}
fn ly(v:f32)->u32{return u32(round(clamp(64.0+876.0*v,64.0,940.0)));}fn lc(v:f32)->u32{return u32(round(clamp(512.0+896.0*v,64.0,960.0)));}
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3<u32>){let x=id.x*2u;let y=id.y;if(x>=params.width||y>=params.height){return;}let a=yuv(vec2<u32>(x,y));let b=yuv(vec2<u32>(min(x+1u,params.width-1u),y));packed[y*(params.width/2u)+id.x]=ly(a.x)|(ly(b.x)<<16u);if((y&1u)==0u&&(id.x&1u)==0u){let ny=min(y+1u,params.height-1u);let c0=(a+b+yuv(vec2<u32>(x,ny))+yuv(vec2<u32>(min(x+1u,params.width-1u),ny)))*0.25;let x2=min(x+2u,params.width-1u);let x3=min(x+3u,params.width-1u);let c1=(yuv(vec2<u32>(x2,y))+yuv(vec2<u32>(x3,y))+yuv(vec2<u32>(x2,ny))+yuv(vec2<u32>(x3,ny)))*0.25;let i=(y/2u)*(params.width/4u)+id.x/2u;packed[params.yPacks+i]=lc(c0.y)|(lc(c1.y)<<16u);packed[params.yPacks+params.uvPacks+i]=lc(c0.z)|(lc(c1.z)<<16u);}}
`

export class HdrLinearCompositor {
  private resources?: Resources
  private current = 0

  constructor(private width: number, private height: number, private transfer: Transfer) {
    if (width % 4 || height % 2) throw new Error('HDR 선형 합성 크기는 너비 4px·높이 2px 배수여야 합니다.')
  }

  async begin(): Promise<void> {
    const r = await this.getResources()
    this.current = 0
    r.device.queue.writeBuffer(r.clearParams, 0, new Uint32Array([this.width, this.height, 0, 0]))
    const group = r.device.createBindGroup({ layout: r.clearPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: r.textures[0].createView() }, { binding: 1, resource: { buffer: r.clearParams } }] })
    await this.dispatch(r, r.clearPipeline, group)
  }

  async addRaw(frame: RawHdrFrame, transform: ClipTransform, color: ColorAdjustment, effects: VisualEffects, mask?: HTMLCanvasElement, face?: { x: number; y: number }): Promise<void> {
    if (frame.layout.length < 3) throw new Error('HDR 원본의 10-bit YUV plane layout을 읽지 못했습니다.')
    if (!frame.displayWidth || !frame.displayHeight || !frame.codedWidth || !frame.codedHeight) throw new Error('HDR 원본 프레임 크기가 올바르지 않습니다.')
    const r = await this.getResources()
    const byteLength = Math.ceil(frame.data.byteLength / 4) * 4
    if (!r.rawInput || r.rawCapacity < byteLength) { r.rawInput?.destroy(); r.rawInput = r.device.createBuffer({ size: byteLength, usage: r.usage.STORAGE | r.usage.COPY_DST }); r.rawCapacity = byteLength }
    const data = byteLength === frame.data.byteLength ? frame.data : new Uint8Array(byteLength)
    if (data !== frame.data) data.set(frame.data)
    r.device.queue.writeBuffer(r.rawInput, 0, data)
    const fit = Math.min(this.width / frame.displayWidth, this.height / frame.displayHeight)
    const angle = transform.rotation * Math.PI / 180
    const drawWidth = frame.displayWidth * fit
    const drawHeight = frame.displayHeight * fit
    const horizontalScale = transform.scale / 100 * (transform.scaleX ?? 100) / 100
    const verticalScale = transform.scale / 100 * (transform.scaleY ?? 100) / 100
    const safeHorizontalScale = Math.abs(horizontalScale) < 0.00001 ? (Math.sign(horizontalScale) || 1) * 0.00001 : horizontalScale
    const safeVerticalScale = Math.abs(verticalScale) < 0.00001 ? (Math.sign(verticalScale) || 1) * 0.00001 : verticalScale
    let skewX = Math.tan(Math.max(-85, Math.min(85, transform.skewX ?? 0)) * Math.PI / 180)
    let skewY = Math.tan(Math.max(-85, Math.min(85, transform.skewY ?? 0)) * Math.PI / 180)
    let skewDeterminant = 1 - skewX * skewY
    if (Math.abs(skewDeterminant) < 0.001) {
      if (Math.abs(skewX) > 0.001) skewY = (1 - (Math.sign(skewDeterminant) || 1) * 0.001) / skewX
      else skewX = (1 - (Math.sign(skewDeterminant) || 1) * 0.001) / Math.max(0.001, skewY)
      skewDeterminant = 1 - skewX * skewY
    }
    const blendMode = hdrBlendModes.indexOf(effects.blendMode ?? 'normal')
    if (mask && (mask.width !== this.width || mask.height !== this.height)) throw new Error('HDR 마스크 캔버스 크기가 출력 크기와 일치하지 않습니다.')
    if (mask) r.device.queue.copyExternalImageToTexture({source:mask},{texture:r.maskTexture,colorSpace:'srgb',premultipliedAlpha:false},{width:this.width,height:this.height})
    const modeAndMask = Math.max(0,blendMode) | (mask ? 256 : 0) | (effects.chromaKeyEnabled ? 512 : 0)
    const key = parseHexColor(effects.chromaKeyColor ?? '#00ff00')
    r.device.queue.writeBuffer(r.curveBuffer, 0, buildCurveTable(color))
    writeNodeGraph(r, color)
    const integers = new Uint32Array([this.width,this.height,frame.codedWidth,frame.codedHeight,frame.layout[0].offset,frame.layout[0].stride,frame.layout[1].offset,frame.layout[1].stride,frame.layout[2].offset,frame.layout[2].stride,this.transfer==='pq'?0:1,modeAndMask,Math.round(frame.visibleRect.x),Math.round(frame.visibleRect.y),Math.round(frame.visibleRect.width),Math.round(frame.visibleRect.height)])
    const lutKind = ['none','cinematic','warm','cool','mono'].indexOf(color.lut)
    const floats = new Float32Array([drawWidth,drawHeight,this.width/2+transform.positionX,this.height/2+transform.positionY,1/safeHorizontalScale,1/safeVerticalScale,drawWidth*(transform.anchorX??50)/100,drawHeight*(transform.anchorY??50)/100,skewX,skewY,1/skewDeterminant,Math.cos(angle),Math.sin(angle),Math.max(0,Math.min(1,transform.opacity/100)),color.exposure,color.contrast/100,color.saturation/100,color.temperature/100,color.tint/100,color.highlights/100,color.shadows/100,(color.hue??0)*Math.PI/180,(color.vibrance??0)/100,(color.fade??0)/100,(color.lift??0)/100,(color.gamma??0)/100,(color.gain??0)/100,(color.curveShadows??0)/100,(color.curveMidtones??0)/100,(color.curveHighlights??0)/100,Math.max(0,Math.min(49,effects.cropTop))/100,Math.max(0,Math.min(49,effects.cropRight))/100,Math.max(0,Math.min(49,effects.cropBottom))/100,Math.max(0,Math.min(49,effects.cropLeft))/100,Math.max(0,Math.min(100,color.vignette??0))/100,Math.max(0,Math.min(64,effects.blur)),Math.max(0,lutKind),clamp01((color.lutIntensity??100)/100),key[0],key[1],key[2],Math.max(0,Math.min(100,effects.chromaKeyTolerance??32))/100*0.6,Math.max(1,Math.min(100,effects.chromaKeySoftness??18))/100*0.35,Math.max(0,Math.min(100,effects.chromaSpill??45))/100,0,0,color.qualifierEnabled?1:0,wrapDegrees(color.qualifierHue??120)/360,Math.max(0,Math.min(180,color.qualifierHueRange??30))/360,clamp01((color.qualifierSaturationMin??20)/100),clamp01((color.qualifierSaturationMax??100)/100),clamp01((color.qualifierLuminanceMin??10)/100),clamp01((color.qualifierLuminanceMax??95)/100),clamp01((color.qualifierSoftness??20)/100),Math.max(-3,Math.min(3,color.qualifierExposure??0)),Math.max(-1,Math.min(2,(color.qualifierSaturation??0)/100)),Math.max(-180,Math.min(180,color.qualifierHueShift??0))/360,hasCustomColorCurves(color)?1:0,clamp01((effects.shadowOpacity??0)/100),Math.max(0,Math.min(64,effects.shadowBlur??0)),effects.shadowX??0,effects.shadowY??0,face&&effects.faceMosaic?1:0,clamp01(face?.x??0.5),clamp01(face?.y??0.5),Math.max(0.05,Math.min(0.45,(effects.mosaicSize??18)/100))])
    const params = new ArrayBuffer(336); new Uint32Array(params,0,16).set(integers); new Float32Array(params,64,66).set(floats); r.device.queue.writeBuffer(r.rawParams,0,params)
    const next = 1-this.current
    const group = r.device.createBindGroup({ layout:r.rawPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:r.rawInput}},{binding:1,resource:r.textures[this.current].createView()},{binding:2,resource:r.textures[next].createView()},{binding:3,resource:{buffer:r.rawParams}},{binding:4,resource:r.maskTexture.createView()},{binding:5,resource:{buffer:r.curveBuffer}},{binding:6,resource:{buffer:r.nodeMetaBuffer}},{binding:7,resource:{buffer:r.nodeValueBuffer}},{binding:8,resource:{buffer:r.nodeCurveBuffer}}] })
    await this.dispatch(r,r.rawPipeline,group); this.current=next
  }

  async addRawBase(frame: RawHdrFrame, transform: ClipTransform): Promise<void> {
    if (frame.layout.length < 3) throw new Error('HDR 원본의 10-bit YUV plane layout을 읽지 못했습니다.')
    const r = await this.getResources()
    const byteLength = Math.ceil(frame.data.byteLength / 4) * 4
    if (!r.rawInput || r.rawCapacity < byteLength) { r.rawInput?.destroy(); r.rawInput = r.device.createBuffer({ size: byteLength, usage: r.usage.STORAGE | r.usage.COPY_DST }); r.rawCapacity = byteLength }
    const data = byteLength === frame.data.byteLength ? frame.data : new Uint8Array(byteLength)
    if (data !== frame.data) data.set(frame.data)
    r.device.queue.writeBuffer(r.rawInput, 0, data)
    const fit = Math.min(this.width / frame.displayWidth, this.height / frame.displayHeight)
    const drawWidth = frame.displayWidth * fit
    const drawHeight = frame.displayHeight * fit
    const horizontalScale = transform.scale / 100 * (transform.scaleX ?? 100) / 100
    const verticalScale = transform.scale / 100 * (transform.scaleY ?? 100) / 100
    const safeX = Math.abs(horizontalScale) < 0.00001 ? 0.00001 : horizontalScale
    const safeY = Math.abs(verticalScale) < 0.00001 ? 0.00001 : verticalScale
    let skewX = Math.tan(Math.max(-85, Math.min(85, transform.skewX ?? 0)) * Math.PI / 180)
    let skewY = Math.tan(Math.max(-85, Math.min(85, transform.skewY ?? 0)) * Math.PI / 180)
    let determinant = 1 - skewX * skewY
    if (Math.abs(determinant) < 0.001) { skewX = 0; skewY = 0; determinant = 1 }
    const angle = transform.rotation * Math.PI / 180
    const integers = new Uint32Array([this.width,this.height,frame.codedWidth,frame.codedHeight,frame.layout[0].offset,frame.layout[0].stride,frame.layout[1].offset,frame.layout[1].stride,frame.layout[2].offset,frame.layout[2].stride,this.transfer==='pq'?0:1,0,Math.round(frame.visibleRect.x),Math.round(frame.visibleRect.y),Math.round(frame.visibleRect.width),Math.round(frame.visibleRect.height)])
    const floats = new Float32Array([drawWidth,drawHeight,this.width/2+transform.positionX,this.height/2+transform.positionY,1/safeX,1/safeY,drawWidth*(transform.anchorX??50)/100,drawHeight*(transform.anchorY??50)/100,skewX,skewY,1/determinant,Math.cos(angle),Math.sin(angle),Math.max(0,Math.min(1,transform.opacity/100)),0,0])
    const params = new ArrayBuffer(128); new Uint32Array(params,0,16).set(integers); new Float32Array(params,64,16).set(floats); r.device.queue.writeBuffer(r.rawBaseParams,0,params)
    const next = 1-this.current
    const group = r.device.createBindGroup({layout:r.rawBasePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:r.rawInput}},{binding:1,resource:r.textures[this.current].createView()},{binding:2,resource:r.textures[next].createView()},{binding:3,resource:{buffer:r.rawBaseParams}}]})
    await this.dispatch(r,r.rawBasePipeline,group); this.current=next
  }

  async addCanvas(canvas: HTMLCanvasElement, blendMode: VisualEffects['blendMode'] = 'normal'): Promise<void> {
    if (canvas.width !== this.width || canvas.height !== this.height) throw new Error('HDR 오버레이 캔버스 크기가 출력 크기와 일치하지 않습니다.')
    const r=await this.getResources(); r.device.queue.copyExternalImageToTexture({source:canvas},{texture:r.canvasTexture,colorSpace:'srgb',premultipliedAlpha:false},{width:this.width,height:this.height})
    const mode=Math.max(0,hdrBlendModes.indexOf(blendMode??'normal'))
    r.device.queue.writeBuffer(r.canvasParams,0,new Uint32Array([this.width,this.height,this.transfer==='pq'?0:1,mode]))
    const next=1-this.current
    const group=r.device.createBindGroup({layout:r.canvasPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:r.canvasTexture.createView()},{binding:1,resource:r.textures[this.current].createView()},{binding:2,resource:r.textures[next].createView()},{binding:3,resource:{buffer:r.canvasParams}}]})
    await this.dispatch(r,r.canvasPipeline,group); this.current=next
  }

  async addAdjustment(color: ColorAdjustment, opacity = 1, blurRadius = 0): Promise<void> {
    const r = await this.getResources()
    r.device.queue.writeBuffer(r.curveBuffer, 0, buildCurveTable(color))
    writeNodeGraph(r, color)
    const lutKind = ['none','cinematic','warm','cool','mono'].indexOf(color.lut)
    const integers = new Uint32Array([this.width, this.height, Math.max(0,lutKind), 0])
    const floats = new Float32Array([color.exposure,color.contrast/100,color.saturation/100,color.temperature/100,color.tint/100,color.highlights/100,color.shadows/100,(color.hue??0)*Math.PI/180,(color.vibrance??0)/100,(color.fade??0)/100,(color.lift??0)/100,(color.gamma??0)/100,(color.gain??0)/100,(color.curveShadows??0)/100,(color.curveMidtones??0)/100,(color.curveHighlights??0)/100,Math.max(0,Math.min(100,color.vignette??0))/100,Math.max(0,Math.min(1,opacity)),Math.max(0,Math.min(64,blurRadius)),clamp01((color.lutIntensity??100)/100),color.qualifierEnabled?1:0,wrapDegrees(color.qualifierHue??120)/360,Math.max(0,Math.min(180,color.qualifierHueRange??30))/360,clamp01((color.qualifierSaturationMin??20)/100),clamp01((color.qualifierSaturationMax??100)/100),clamp01((color.qualifierLuminanceMin??10)/100),clamp01((color.qualifierLuminanceMax??95)/100),clamp01((color.qualifierSoftness??20)/100),Math.max(-3,Math.min(3,color.qualifierExposure??0)),Math.max(-1,Math.min(2,(color.qualifierSaturation??0)/100)),Math.max(-180,Math.min(180,color.qualifierHueShift??0))/360,hasCustomColorCurves(color)?1:0])
    const params = new ArrayBuffer(144)
    new Uint32Array(params, 0, 4).set(integers)
    new Float32Array(params, 16, 32).set(floats)
    r.device.queue.writeBuffer(r.adjustmentParams, 0, params)
    const next = 1-this.current
    const group = r.device.createBindGroup({layout:r.adjustmentPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:r.textures[this.current].createView()},{binding:1,resource:r.textures[next].createView()},{binding:2,resource:{buffer:r.adjustmentParams}},{binding:3,resource:{buffer:r.curveBuffer}},{binding:4,resource:{buffer:r.nodeMetaBuffer}},{binding:5,resource:{buffer:r.nodeValueBuffer}},{binding:6,resource:{buffer:r.nodeCurveBuffer}}]})
    await this.dispatch(r,r.adjustmentPipeline,group)
    this.current=next
  }

  async finish(): Promise<HdrFrameData> {
    const r=await this.getResources(); const yPacks=this.width*this.height/2;const uvPacks=this.width*this.height/8
    r.device.queue.writeBuffer(r.outputParams,0,new Uint32Array([this.width,this.height,this.transfer==='pq'?0:1,yPacks,uvPacks,0,0,0]))
    const group=r.device.createBindGroup({layout:r.outputPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:r.textures[this.current].createView()},{binding:1,resource:{buffer:r.output}},{binding:2,resource:{buffer:r.outputParams}}]})
    const encoder=r.device.createCommandEncoder();const pass=encoder.beginComputePass();pass.setPipeline(r.outputPipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(this.width/16),Math.ceil(this.height/8));pass.end();encoder.copyBufferToBuffer(r.output,0,r.readback,0,r.outputByteLength);r.device.queue.submit([encoder.finish()]);await r.readback.mapAsync(r.mapMode.READ);const data=new Uint8Array(r.readback.getMappedRange()).slice();r.readback.unmap()
    const luma=this.width*this.height*2;const chroma=this.width*this.height/2
    return {data,layout:[{offset:0,stride:this.width*2},{offset:luma,stride:this.width},{offset:luma+chroma,stride:this.width}],colorSpace:{primaries:'bt2020',transfer:this.transfer,matrix:'bt2020-ncl',fullRange:false} as unknown as VideoColorSpaceInit}
  }

  destroy():void{const r=this.resources;if(!r)return;r.rawInput?.destroy();r.textures.forEach((t)=>t.destroy());r.canvasTexture.destroy();r.maskTexture.destroy();r.output.destroy();r.readback.destroy();r.clearParams.destroy();r.rawBaseParams.destroy();r.rawParams.destroy();r.adjustmentParams.destroy();r.curveBuffer.destroy();r.nodeMetaBuffer.destroy();r.nodeValueBuffer.destroy();r.nodeCurveBuffer.destroy();r.canvasParams.destroy();r.outputParams.destroy();this.resources=undefined}

  private async dispatch(r:Resources,pipeline:any,group:any):Promise<void>{const encoder=r.device.createCommandEncoder();const pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(this.width/8),Math.ceil(this.height/8));pass.end();r.device.queue.submit([encoder.finish()]);await r.device.queue.onSubmittedWorkDone()}

  private async getResources(): Promise<Resources> {
    if (this.resources) return this.resources
    const gpu = (navigator as Navigator & { gpu?: any }).gpu
    if (!gpu) throw new Error('HDR RGBA16F 합성에는 WebGPU가 필요합니다.')
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) throw new Error('HDR 합성 GPU 어댑터를 찾지 못했습니다.')
    const device = await adapter.requestDevice()
    const usage = (globalThis as any).GPUBufferUsage
    const textureUsage = (globalThis as any).GPUTextureUsage
    const mapMode = (globalThis as any).GPUMapMode
    if (!usage || !textureUsage || !mapMode) throw new Error('WebGPU 상수를 사용할 수 없습니다.')
    const textureOptions = { size: [this.width, this.height], format: 'rgba16float', usage: textureUsage.TEXTURE_BINDING | textureUsage.STORAGE_BINDING }
    const textures: [any, any] = [device.createTexture(textureOptions), device.createTexture(textureOptions)]
    const canvasTexture = device.createTexture({ size: [this.width, this.height], format: 'rgba8unorm', usage: textureUsage.TEXTURE_BINDING | textureUsage.COPY_DST })
    const maskTexture = device.createTexture({ size: [this.width, this.height], format: 'rgba8unorm', usage: textureUsage.TEXTURE_BINDING | textureUsage.COPY_DST })
    const make = async (code: string, label: string) => {
      const module = device.createShaderModule({ code, label })
      const info = typeof module.getCompilationInfo === 'function' ? await module.getCompilationInfo() : undefined
      const errors = info?.messages?.filter((message: { type: string }) => message.type === 'error') ?? []
      if (errors.length) throw new Error(`${label} WGSL 컴파일 실패: ${errors.map((message: { lineNum?: number; linePos?: number; message: string }) => `${message.lineNum ?? '?'}:${message.linePos ?? '?'} ${message.message}`).join(' | ')}`)
      return typeof device.createComputePipelineAsync === 'function'
        ? device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } })
        : device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } })
    }
    const clearPipeline = await make(clearShader, 'HDR clear')
    const rawBasePipeline = await make(rawBaseShader, 'HDR raw base')
    const rawPipeline = await make(rawShader, 'HDR raw effects')
    const adjustmentPipeline = await make(adjustmentShader, 'HDR adjustment')
    const canvasPipeline = await make(canvasShader, 'HDR canvas')
    const outputPipeline = await make(outputShader, 'HDR output')
    const clearParams = device.createBuffer({ size: 16, usage: usage.UNIFORM | usage.COPY_DST })
    const rawBaseParams = device.createBuffer({ size: 128, usage: usage.UNIFORM | usage.COPY_DST })
    const rawParams = device.createBuffer({ size: 336, usage: usage.UNIFORM | usage.COPY_DST })
    const adjustmentParams = device.createBuffer({ size: 144, usage: usage.UNIFORM | usage.COPY_DST })
    const curveBuffer = device.createBuffer({ size: 4096, usage: usage.STORAGE | usage.COPY_DST })
    const nodeMetaBuffer = device.createBuffer({ size: 1296, usage: usage.STORAGE | usage.COPY_DST })
    const nodeValueBuffer = device.createBuffer({ size: 2560, usage: usage.STORAGE | usage.COPY_DST })
    const nodeCurveBuffer = device.createBuffer({ size: 65536, usage: usage.STORAGE | usage.COPY_DST })
    const canvasParams = device.createBuffer({ size: 16, usage: usage.UNIFORM | usage.COPY_DST })
    const outputParams = device.createBuffer({ size: 32, usage: usage.UNIFORM | usage.COPY_DST })
    const yPacks = this.width * this.height / 2
    const uvPacks = this.width * this.height / 8
    const outputByteLength = (yPacks + uvPacks * 2) * 4
    const output = device.createBuffer({ size: outputByteLength, usage: usage.STORAGE | usage.COPY_SRC })
    const readback = device.createBuffer({ size: outputByteLength, usage: usage.COPY_DST | usage.MAP_READ })
    this.resources = { device, usage, textureUsage, mapMode, textures, canvasTexture, maskTexture, clearPipeline, rawBasePipeline, rawPipeline, adjustmentPipeline, canvasPipeline, outputPipeline, clearParams, rawBaseParams, rawParams, adjustmentParams, curveBuffer, nodeMetaBuffer, nodeValueBuffer, nodeCurveBuffer, canvasParams, outputParams, rawCapacity: 0, output, readback, outputByteLength }
    return this.resources
  }
}

function parseHexColor(value: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim())
  if (!match) return [0, 1, 0]
  const packed = Number.parseInt(match[1], 16)
  return [((packed >> 16) & 255) / 255, ((packed >> 8) & 255) / 255, (packed & 255) / 255]
}

function buildCurveTable(color: ColorAdjustment): Float32Array {
  const output = new Float32Array(1024)
  const curves = [color.masterCurve, color.redCurve, color.greenCurve, color.blueCurve].map(normalizeColorCurve)
  curves.forEach((curve, channel) => {
    let segment = 0
    for (let index = 0; index < 256; index++) {
      const input = index / 255
      while (segment + 1 < curve.length - 1 && input > curve[segment + 1].x) segment++
      const from = curve[segment]
      const to = curve[Math.min(curve.length - 1, segment + 1)]
      const progress = (input - from.x) / Math.max(0.000001, to.x - from.x)
      output[channel * 256 + index] = clamp01(from.y + (to.y - from.y) * progress)
    }
  })
  return output
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
}

function wrapDegrees(value: number): number {
  return ((Number.isFinite(value) ? value : 0) % 360 + 360) % 360
}

function writeNodeGraph(resources: Resources, color: ColorAdjustment): void {
  const graph = buildNodeGraph(color)
  resources.device.queue.writeBuffer(resources.nodeMetaBuffer, 0, graph.meta)
  resources.device.queue.writeBuffer(resources.nodeValueBuffer, 0, graph.values)
  resources.device.queue.writeBuffer(resources.nodeCurveBuffer, 0, graph.curves)
}

function buildNodeGraph(color: ColorAdjustment): { meta: Uint32Array; values: Float32Array; curves: Float32Array } {
  const nodes = (color.colorNodes ?? []).slice(0, 16)
  const meta = new Uint32Array(324)
  const values = new Float32Array(640)
  const curves = new Float32Array(16 * 1024)
  for (let node = 0; node < 16; node++) for (let channel = 0; channel < 4; channel++) for (let index = 0; index < 256; index++) curves[node * 1024 + channel * 256 + index] = index / 255
  meta[0] = nodes.length
  const indexById = new Map<string, number>([['source', 0]])
  nodes.forEach((node, index) => indexById.set(node.id, index + 1))
  const outputIndex = color.colorOutputNodeId ? indexById.get(color.colorOutputNodeId) : undefined
  meta[1] = outputIndex !== undefined && outputIndex <= nodes.length ? outputIndex : nodes.length
  nodes.forEach((node, index) => {
    const metaBase = 4 + index * 20
    meta[metaBase] = ['primary', 'curves', 'qualifier', 'look', 'tone-map'].indexOf(node.type)
    meta[metaBase + 1] = node.enabled ? 1 : 0
    meta[metaBase + 2] = ['normal', 'add', 'multiply', 'screen'].indexOf(node.blendMode)
    const inputs = node.inputIds.map((id) => indexById.get(id)).filter((value): value is number => value !== undefined && value <= index).slice(0, 16)
    const resolvedInputs = inputs.length ? inputs : [index > 0 ? index : 0]
    meta[metaBase + 3] = resolvedInputs.length
    resolvedInputs.forEach((input, inputIndex) => { meta[metaBase + 4 + inputIndex] = input })
    const adjustment = { ...defaultColorAdjustment(), ...node.adjustment, colorNodes: undefined, colorOutputNodeId: undefined } as ColorAdjustment
    const valueBase = index * 40
    const lutKind = ['none', 'cinematic', 'warm', 'cool', 'mono'].indexOf(adjustment.lut)
    const toneMethod = ['hable', 'reinhard', 'mobius'].indexOf(node.adjustment.toneMapMethod ?? 'hable')
    values.set([
      Math.max(0, Math.min(100, node.mix)) / 100,
      adjustment.exposure, adjustment.contrast / 100, adjustment.saturation / 100, adjustment.temperature / 100, adjustment.tint / 100,
      adjustment.highlights / 100, adjustment.shadows / 100, (adjustment.hue ?? 0) * Math.PI / 180, (adjustment.vibrance ?? 0) / 100,
      (adjustment.fade ?? 0) / 100, (adjustment.lift ?? 0) / 100, (adjustment.gamma ?? 0) / 100, (adjustment.gain ?? 0) / 100,
      (adjustment.curveShadows ?? 0) / 100, (adjustment.curveMidtones ?? 0) / 100, (adjustment.curveHighlights ?? 0) / 100,
      adjustment.qualifierEnabled ? 1 : 0, wrapDegrees(adjustment.qualifierHue ?? 120) / 360, Math.max(0, Math.min(180, adjustment.qualifierHueRange ?? 30)) / 360,
      clamp01((adjustment.qualifierSaturationMin ?? 20) / 100), clamp01((adjustment.qualifierSaturationMax ?? 100) / 100),
      clamp01((adjustment.qualifierLuminanceMin ?? 10) / 100), clamp01((adjustment.qualifierLuminanceMax ?? 95) / 100), clamp01((adjustment.qualifierSoftness ?? 20) / 100),
      Math.max(-3, Math.min(3, adjustment.qualifierExposure ?? 0)), Math.max(-1, Math.min(2, (adjustment.qualifierSaturation ?? 0) / 100)), Math.max(-180, Math.min(180, adjustment.qualifierHueShift ?? 0)) / 360,
      Math.max(0, lutKind), clamp01(adjustment.lutIntensity / 100), Math.max(0, toneMethod), Math.max(1, Number(node.adjustment.sourcePeakNits ?? 1000)), Math.max(1, Number(node.adjustment.targetPeakNits ?? 100)),
    ], valueBase)
    curves.set(buildCurveTable(adjustment), index * 1024)
  })
  return { meta, values, curves }
}
