import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';

import { Construct } from 'constructs';

export class IacStack extends cdk.Stack {
  constructor(scope: Construct, id: string,  props?: cdk.StackProps) {
    super(scope, id, props);

    const stage = process.env.GITHUB_REF_NAME || 'dev';
    const acmCertificateArn = process.env.ACM_CERTIFICATE_ARN || 'arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012';
    const alternativeDomain = process.env.ALTERNATIVE_DOMAIN_NAME || 'dev_in_the_dark.devmaua.com';
    const hostedZoneIdValue = process.env.HOSTED_ZONE_ID || 'Z1UJRXOUMOOFQ8';
    const projectName = process.env.PROJECT_NAME || 'DevInTheDarkFront';

    const s3Bucket = new s3.Bucket(this, projectName + 'Bucket' + stage, {
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      accessControl: s3.BucketAccessControl.PRIVATE,
      autoDeleteObjects: true,
    });


    const oac = new cloudfront.CfnOriginAccessControl(this, 'AOC', {
      originAccessControlConfig: {
        name: projectName + 'Bucket OAC' + stage,
        originAccessControlOriginType: 's3',
        signingBehavior: 'always',
        signingProtocol: 'sigv4',
      },
    })

    let viewerCertificate = cloudfront.ViewerCertificate.fromCloudFrontDefaultCertificate()
    if (stage === 'prod') {
        viewerCertificate = cloudfront.ViewerCertificate.fromAcmCertificate(
        Certificate.fromCertificateArn(this, projectName + 'Certificate-' + stage, acmCertificateArn),
        {
          aliases: [alternativeDomain],
          securityPolicy: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
        },
        )
    }
    
    const cloudFrontWebDistribution = new cloudfront.CloudFrontWebDistribution(this, 'CDN', {
      comment: projectName + 'Distribution ' + stage,
      originConfigs: [
        {
          s3OriginSource: {
            s3BucketSource: s3Bucket,
          },
          behaviors: [
            {
              isDefaultBehavior: true,
              allowedMethods: cloudfront.CloudFrontAllowedMethods.GET_HEAD,
              compress: true,
              cachedMethods: cloudfront.CloudFrontAllowedCachedMethods.GET_HEAD,
              viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
              minTtl: cdk.Duration.seconds(0),
              maxTtl: cdk.Duration.seconds(86400),
              defaultTtl: cdk.Duration.seconds(3600),
            },
          ],
        },
      ],
      viewerCertificate: viewerCertificate,
      errorConfigurations: [
        {
          errorCode: 403,
          responseCode: 200,
          responsePagePath: '/index.html',
          errorCachingMinTtl: 0,
        },
      ],
    })
    
    const cfnDistribution = cloudFrontWebDistribution.node.defaultChild as cloudfront.CfnDistribution

    cfnDistribution.addPropertyOverride('DistributionConfig.Origins.0.OriginAccessControlId', oac.getAtt('Id'))

    
    s3Bucket.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:GetObject'],
        principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
        resources: [s3Bucket.arnForObjects('*')],
      }),
    )  

    if (stage === 'prod') {
      const zone = route53.HostedZone.fromHostedZoneAttributes(this, projectName + 'HostedZone-' + stage, {
        hostedZoneId: hostedZoneIdValue,
        zoneName: alternativeDomain,
      });
          
      new route53.ARecord(this, projectName + 'AliasRecord-' + stage, {
        zone: zone,
        recordName: alternativeDomain,
        target: route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(cloudFrontWebDistribution)),
      });
    }
      
    new cdk.CfnOutput(this, projectName + 'BucketName-' + stage, {
      value: s3Bucket.bucketName,
    });

    new cdk.CfnOutput(this, projectName + 'DistributionId-' + stage, {
      value: cloudFrontWebDistribution.distributionId,
    });

    new cdk.CfnOutput(this, projectName + 'DistributionDomainName-' + stage, {
      value: cloudFrontWebDistribution.distributionDomainName,
    });
    

  }
}